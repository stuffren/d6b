import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd

from common import (
    DATA_DIR,
    DEFAULT_BOARDS,
    EM_DATACENTER_REFERER,
    KIND_DRAGON_TIGER,
    LHB_WORKERS,
    MAX_PAGES,
    PAGE_SIZE_LHB,
    PAGE_SIZE_SEAT,
    SEAT_AMT_UNIT,
    SourceUnavailableError,
    filter_boards,
    filter_st,
    fmt_seat,
    http_get_json,
    norm_code,
    parse_amount,
    parse_date,
    parse_pct,
    save_excel,
    save_json,
    setup_logger,
    write_failed,
)

EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get"
SUMMARY_RPT = "RPT_DAILYBILLBOARD_DETAILSNEW"
BUY_RPT = "RPT_BILLBOARD_DAILYDETAILSBUY"
SELL_RPT = "RPT_BILLBOARD_DAILYDETAILSSELL"
SIDES = ("buy", "sell")

SUMMARY_COLUMNS = ("代码", "名称", "现价", "涨跌幅", "龙虎榜成交额", "合计买入", "合计卖出", "净额")
REASON_COLUMN = "上榜原因"
INTERNAL_REASON = "_target_exp"

BUY_SEAT_COLUMNS = tuple("买入营业部{}".format(i) for i in range(1, 6))
SELL_SEAT_COLUMNS = tuple("卖出营业部{}".format(i) for i in range(1, 6))
COLUMNS_COMBO = SUMMARY_COLUMNS + BUY_SEAT_COLUMNS + SELL_SEAT_COLUMNS + (REASON_COLUMN,)

BUY_SPLIT_COLUMNS = tuple(
    label
    for i in range(1, 6)
    for label in ("买入营业部{}".format(i), "买入金额{}".format(i))
)
SELL_SPLIT_COLUMNS = tuple(
    label
    for i in range(1, 6)
    for label in ("卖出营业部{}".format(i), "卖出金额{}".format(i))
)
COLUMNS_SPLIT = SUMMARY_COLUMNS + BUY_SPLIT_COLUMNS + SELL_SPLIT_COLUMNS

LOGGER_NAME = "market"
SEAT_FIELDS = {"buy": "BUY", "sell": "SELL"}
SCHEMA_VERSION = "1.0"


def _em_params(report, flt, page, page_size, extra=None):
    params = {
        "reportName": report,
        "columns": "ALL",
        "filter": flt,
        "pageNumber": page,
        "pageSize": page_size,
        "source": "WEB",
        "client": "WEB",
    }
    if extra:
        params.update(extra)
    return params


def _result_node(data):
    node = (data or {}).get("result") if isinstance(data, dict) else None
    return node if isinstance(node, dict) else None


def _paged_fetch(report, flt, page_size, extra=None):
    rows = []
    page = 1
    total = 0
    while page <= MAX_PAGES:
        params = _em_params(report, flt, page, page_size, extra)
        data, err = http_get_json(EM_URL, params, referer=EM_DATACENTER_REFERER)
        if err:
            return rows, err
        node = _result_node(data)
        if node is None:
            message = ""
            if isinstance(data, dict):
                message = str(data.get("message") or data.get("code") or "")
            return rows, "返回结构缺少 result {}".format(message).strip()
        chunk = node.get("data") or []
        if not chunk:
            break
        rows.extend(chunk)
        total = node.get("count") or 0
        if total and len(rows) >= total:
            break
        page += 1
    return rows, ""


def fetch_lhb_summary(date_str):
    flt = "(TRADE_DATE='{}')".format(parse_date(date_str))
    extra = {"sortColumns": "SECURITY_CODE", "sortTypes": "1"}
    rows, err = _paged_fetch(SUMMARY_RPT, flt, PAGE_SIZE_LHB, extra)
    logging.getLogger(LOGGER_NAME).info(
        "龙虎榜汇总主源: 日期 %s | 累计 %s 条", parse_date(date_str), len(rows)
    )
    return rows, err


def fetch_seats(code, date_str, side):
    report = BUY_RPT if side == "buy" else SELL_RPT
    flt = "(TRADE_DATE='{}')(SECURITY_CODE=\"{}\")".format(
        parse_date(date_str), norm_code(code)
    )
    return _paged_fetch(report, flt, PAGE_SIZE_SEAT)


def fetch_seats_batch(codes, date_str):
    logger = logging.getLogger(LOGGER_NAME)
    seats = {}
    failed = []
    ordered = [norm_code(code) for code in codes if norm_code(code)]
    total = len(ordered) * len(SIDES)
    with ThreadPoolExecutor(max_workers=LHB_WORKERS) as pool:
        futures = {
            pool.submit(fetch_seats, code, date_str, side): (code, side)
            for code in ordered
            for side in SIDES
        }
        for index, future in enumerate(as_completed(futures), 1):
            code, side = futures[future]
            try:
                rows, err = future.result()
            except Exception as exc:
                rows, err = [], "{}: {}".format(type(exc).__name__, exc)
            seats[(code, side)] = rows or []
            if err:
                failed.append({"代码": code, "方向": side, "原因": err})
            if index % 50 == 0 or index == total:
                logger.info("席位进度 %s/%s | 失败 %s", index, total, len(failed))
    return seats, failed


def fetch_sse_lhb(date_str):
    logging.getLogger(LOGGER_NAME).warning(
        "上交所龙虎榜兜底未接入：CATALOGID/SQLID 未实测通过（V6），跳过"
    )
    return [], "上交所兜底参数未实测（V6 未通过），暂不启用"


def fetch_szse_lhb(date_str):
    logging.getLogger(LOGGER_NAME).warning(
        "深交所龙虎榜兜底未接入：CATALOGID 未实测通过（V6），跳过"
    )
    return [], "深交所兜底参数未实测（V6 未通过），暂不启用"


def _trade_date_ok(row, target):
    raw = str(row.get("TRADE_DATE") or "").strip()
    return raw[:10] == target


def normalize_lhb(raw, date_str):
    logger = logging.getLogger(LOGGER_NAME)
    target = parse_date(date_str)
    stats = {"date_mismatch": 0, "duplicated": 0, "dropped": 0}
    seen = set()
    rows = []
    for item in raw or []:
        if not isinstance(item, dict):
            stats["dropped"] += 1
            continue
        if not _trade_date_ok(item, target):
            stats["date_mismatch"] += 1
            continue
        code = norm_code(item.get("SECURITY_CODE"))
        if not code:
            stats["dropped"] += 1
            continue
        reason = str(item.get("EXPLANATION") or "").strip()
        key = (code, reason)
        if key in seen:
            stats["duplicated"] += 1
            continue
        seen.add(key)
        rows.append({
            "代码": code,
            "名称": str(item.get("SECURITY_NAME_ABBR") or "").strip(),
            "现价": round(parse_amount(item.get("CLOSE_PRICE")), 2),
            "涨跌幅": round(parse_pct(item.get("CHANGE_RATE")), 2),
            "龙虎榜成交额": parse_amount(item.get("BILLBOARD_DEAL_AMT")),
            "合计买入": parse_amount(item.get("BILLBOARD_BUY_AMT")),
            "合计卖出": parse_amount(item.get("BILLBOARD_SELL_AMT")),
            "净额": parse_amount(item.get("BILLBOARD_NET_AMT")),
            "EXPLANATION": reason,
        })
    if stats["date_mismatch"]:
        logger.warning(
            "龙虎榜丢弃 TRADE_DATE 与目标日期不符的记录 %s 条", stats["date_mismatch"]
        )
    if stats["duplicated"]:
        logger.info("龙虎榜按 (代码, 上榜原因) 去重，丢弃重复 %s 条", stats["duplicated"])
    if stats["dropped"]:
        logger.warning("龙虎榜丢弃无法解析的记录 %s 条", stats["dropped"])
    return pd.DataFrame(
        rows, columns=list(SUMMARY_COLUMNS) + ["EXPLANATION"]
    ), stats


def aggregate(df, keep_reason=False):
    logger = logging.getLogger(LOGGER_NAME)
    rows = []
    multi = []
    if keep_reason:
        for (code, reason), group in df.groupby(["代码", "EXPLANATION"], sort=False):
            head = group.iloc[0]
            record = {col: head[col] for col in SUMMARY_COLUMNS}
            record[REASON_COLUMN] = str(reason or "").strip()
            record[INTERNAL_REASON] = str(reason or "").strip()
            rows.append(record)
        logger.info("按规则分别输出：%s 行（不聚合）", len(rows))
        return pd.DataFrame(
            rows, columns=list(SUMMARY_COLUMNS) + [REASON_COLUMN, INTERNAL_REASON]
        )
    for code, group in df.groupby("代码", sort=False):
        ordered = group.sort_values("龙虎榜成交额", ascending=False, kind="mergesort")
        head = ordered.iloc[0]
        reasons = []
        for value in group["EXPLANATION"].tolist():
            text = str(value or "").strip()
            if text and text not in reasons:
                reasons.append(text)
        amounts = [parse_amount(v) for v in ordered["龙虎榜成交额"].tolist()]
        if len(set(round(v, 2) for v in amounts)) > 1:
            multi.append((code, amounts))
            logger.warning(
                "多口径聚合: %s 成交额 %s，席位取最大口径 %s",
                code, amounts, str(head.get("EXPLANATION") or "").strip(),
            )
        record = {col: head[col] for col in SUMMARY_COLUMNS}
        record[REASON_COLUMN] = "；".join(reasons)
        record[INTERNAL_REASON] = str(head.get("EXPLANATION") or "").strip()
        rows.append(record)
    if multi:
        logger.warning("本日 %s 只股票存在多口径，已聚合", len(multi))
    return pd.DataFrame(
        rows, columns=list(SUMMARY_COLUMNS) + [REASON_COLUMN, INTERNAL_REASON]
    )


def _seat_pairs(rows, side, target_exp):
    if not rows:
        return []
    field = SEAT_FIELDS[side]
    groups = {}
    for row in rows:
        exp = str(row.get("EXPLANATION") or "").strip()
        groups.setdefault(exp, []).append(row)
    chosen = groups.get(target_exp) or []
    ordered = sorted(
        chosen, key=lambda item: parse_amount(item.get(field)), reverse=True
    )
    pairs = []
    for row in ordered[:5]:
        name = str(row.get("OPERATEDEPT_NAME") or "").strip()
        amount = parse_amount(row.get(field)) * SEAT_AMT_UNIT
        pairs.append((name, amount))
    return pairs


def _padded(pairs, size=5):
    items = list(pairs)[:size]
    while len(items) < size:
        items.append(("", 0.0))
    return items


def _seat_items(rows, side, target_exp):
    if not rows:
        return []
    field = SEAT_FIELDS[side]
    chosen = []
    for row in rows:
        if str(row.get("EXPLANATION") or "").strip() == target_exp:
            chosen.append(row)
    ordered = sorted(
        chosen, key=lambda item: parse_amount(item.get(field)), reverse=True
    )
    items = []
    for row in ordered[:5]:
        name = str(row.get("OPERATEDEPT_NAME") or "").strip()
        if not name:
            continue
        items.append({
            "name": name,
            "amount": parse_amount(row.get(field)) * SEAT_AMT_UNIT,
        })
    return items


def build_output(agg, seats, layout="combo", keep_reason=False):
    split = str(layout).lower() == "split"
    no_seat = 0
    rows = []
    for _, record in agg.iterrows():
        code = record["代码"]
        target_exp = str(record.get(INTERNAL_REASON) or "").strip()
        buy = _seat_pairs(seats.get((code, "buy")), "buy", target_exp)
        sell = _seat_pairs(seats.get((code, "sell")), "sell", target_exp)
        if not buy or not sell:
            no_seat += 1
        out = {col: record[col] for col in SUMMARY_COLUMNS}
        if split:
            for index, (name, amount) in enumerate(_padded(buy), 1):
                out["买入营业部{}".format(index)] = name
                out["买入金额{}".format(index)] = round(amount / 10000.0, 2)
            for index, (name, amount) in enumerate(_padded(sell), 1):
                out["卖出营业部{}".format(index)] = name
                out["卖出金额{}".format(index)] = round(amount / 10000.0, 2)
            columns = COLUMNS_SPLIT + ((REASON_COLUMN,) if keep_reason else ())
            if keep_reason:
                out[REASON_COLUMN] = record[REASON_COLUMN]
        else:
            for index, pair in enumerate(_padded(buy), 1):
                out["买入营业部{}".format(index)] = fmt_seat(pair[0], pair[1])
            for index, pair in enumerate(_padded(sell), 1):
                out["卖出营业部{}".format(index)] = fmt_seat(pair[0], pair[1])
            out[REASON_COLUMN] = record[REASON_COLUMN]
            columns = COLUMNS_COMBO
        rows.append(out)
    return pd.DataFrame(rows, columns=list(columns)), no_seat


def build_json_payload(df, seats, date_str):
    target = parse_date(date_str)
    seen = {}
    for _, row in df.iterrows():
        code = str(row.get("代码") or "").strip()
        if not code:
            continue
        reason = str(row.get("EXPLANATION") or "").strip()
        node = seen.get(code)
        if node is None:
            node = {
                "code": code,
                "name": str(row.get("名称") or "").strip(),
                "entries": [],
            }
            seen[code] = node
        node["entries"].append({
            "reason": reason,
            "trade_amount": round(parse_amount(row.get("龙虎榜成交额")), 2),
            "buy_amount": round(parse_amount(row.get("合计买入")), 2),
            "sell_amount": round(parse_amount(row.get("合计卖出")), 2),
            "net_amount": round(parse_amount(row.get("净额")), 2),
            "seats": {
                "buy": _seat_items(seats.get((code, "buy")), "buy", reason),
                "sell": _seat_items(seats.get((code, "sell")), "sell", reason),
            },
        })
    return {
        "schema_version": SCHEMA_VERSION,
        "trade_date": target,
        "stocks": list(seen.values()),
    }


def run(
    date_str,
    boards=DEFAULT_BOARDS,
    drop_st=True,
    fallback=True,
    layout="combo",
    keep_reason=False,
    outdir=DATA_DIR,
    json_out=False,
):
    logger = setup_logger(LOGGER_NAME)
    started = time.time()
    target = parse_date(date_str)

    raw, err = fetch_lhb_summary(target)
    if err:
        logger.warning("龙虎榜汇总主源失败: %s", err)

    fallback_used = False
    if (err or not raw) and fallback:
        logger.info("龙虎榜汇总主源为空，尝试交易所兜底")
        sse_rows, sse_err = fetch_sse_lhb(target)
        szse_rows, szse_err = fetch_szse_lhb(target)
        if sse_rows or szse_rows:
            raw = list(sse_rows) + list(szse_rows)
            err = ""
            fallback_used = True
            logger.warning("龙虎榜使用交易所兜底，共 %s 条", len(raw))
        else:
            logger.warning(
                "龙虎榜兜底不可用: %s / %s", sse_err or "无数据", szse_err or "无数据"
            )

    if not raw:
        raise SourceUnavailableError("{} 龙虎榜无数据（主源与兜底均不可用）".format(target))

    df, norm_stats = normalize_lhb(raw, target)
    raw_count = len(df)
    df = filter_boards(df, boards, "代码")
    board_filtered = len(df)
    if drop_st:
        df = filter_st(df, "名称")
    st_filtered = len(df)

    if not len(df):
        logger.warning(
            "%s 龙虎榜在目标板块内无数据（板块过滤后为 0），输出空表", target
        )

    codes = df["代码"].unique().tolist()
    logger.info(
        "龙虎榜: 原始 %s → 板块 %s → 剔除ST %s | 取席位 %s 只",
        raw_count, board_filtered, st_filtered, len(codes),
    )

    seats, failed = fetch_seats_batch(codes, target)
    supplement = 0
    empty_tasks = sum(1 for rows in seats.values() if not rows)
    if fallback and (failed or empty_tasks):
        logger.warning(
            "席位缺失 %s 个任务（请求失败 %s），交易所兜底未接入（V6 未通过），补数 0",
            empty_tasks, len(failed),
        )

    agg = aggregate(df, keep_reason=keep_reason)
    out, no_seat = build_output(agg, seats, layout=layout, keep_reason=keep_reason)
    final_count = len(out)

    if failed:
        failed_path = write_failed(KIND_DRAGON_TIGER, target, failed)
        if failed_path:
            logger.warning("席位失败明细已写入 %s", failed_path)
    if no_seat:
        logger.warning("无席位股票 %s 只（席位为空或未命中目标规则）", no_seat)

    path = save_excel(out, KIND_DRAGON_TIGER, target, outdir=outdir)

    json_path = ""
    json_stats = {}
    if json_out:
        payload = build_json_payload(df, seats, target)
        json_path = save_json(payload, KIND_DRAGON_TIGER, target, outdir=outdir)
        json_stats = {
            "stock_count": len(payload["stocks"]),
            "entry_count": sum(len(item["entries"]) for item in payload["stocks"]),
        }
        logger.info(
            "龙虎榜 JSON: %s 只股票 / %s 条记录 -> %s",
            json_stats["stock_count"], json_stats["entry_count"], json_path,
        )

    elapsed = round(time.time() - started, 2)
    logger.info(
        "龙虎榜完成: 输出 %s 行 × %s 列 | %s | %.2fs",
        final_count, len(out.columns), path, elapsed,
    )

    return {
        "kind": KIND_DRAGON_TIGER,
        "date": target,
        "raw_count": raw_count,
        "board_filtered": board_filtered,
        "st_filtered": st_filtered,
        "final_count": final_count,
        "no_seat_count": no_seat,
        "fallback_used": fallback_used,
        "fallback_supplement": supplement,
        "failed_count": len(failed),
        "multi_reason": int(
            agg[REASON_COLUMN].str.contains("；", na=False).sum()
        ),
        "duplicated": norm_stats["duplicated"],
        "path": path,
        "json_path": json_path,
        "json_stats": json_stats,
        "elapsed": elapsed,
    }