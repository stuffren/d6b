import os
import random
import time
import logging
import re
import json
from bisect import bisect_left
from datetime import date, datetime, timedelta, timezone

import pandas as pd

from common import (
    DATA_DIR,
    DEFAULT_BOARDS,
    EM_ZT_REFERER,
    EM_ZT_UT,
    FALLBACK_SLEEP,
    KIND_LIMIT_UP,
    MAX_PAGES,
    PAGE_SIZE_ZT,
    DataNotReadyError,
    SourceUnavailableError,
    filter_boards,
    filter_st,
    fmt_board_count,
    fmt_time,
    http_get_json,
    load_themes,
    load_trade_calendar,
    meta_path,
    norm_code,
    parse_date,
    prev_trade_date,
    read_json,
    save_excel,
    save_json,
    setup_logger,
)

ZT_URL = "https://push2ex.eastmoney.com/getTopicZTPool"
THS_URL = "https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool"
THS_REFERER = "https://data.10jqka.com.cn/"

ZT_WINDOW_DAYS = 15
ZT_COLUMNS = ("板数", "代码", "名称", "时间", "主线板块", "涨停原因")

THS_FIELDS = (
    "199112,10,9001,330323,330324,330325,9002,330329,133971,"
    "133970,1968584,3475914,9003,9004"
)
THS_PAGE_SIZE = 200
CST = timezone(timedelta(hours=8))

LOGGER_NAME = "market"

SCHEMA_VERSION = "1.0"
THEME_OTHER = "其他概念"
REASON_SEPARATOR = "+"
REASON_UNKNOWN = "未知"
THEME_REASON_SUFFIX = "板块当日涨停"
THEME_TYPE_PREFIX = "event"
THEME_SENTIMENT = "sentiment"

_PROBE_THEME_LIMIT = 10


def fetch_zt_pool(date_str):
    params = {
        "ut": EM_ZT_UT,
        "dpt": "wz.ztzt",
        "date": parse_date(date_str).replace("-", ""),
        "Pageindex": 0,
        "pagesize": PAGE_SIZE_ZT,
        "sort": "fbt:asc",
    }
    pool = []
    total = 0
    page = 0
    qdate = None
    while page < MAX_PAGES:
        params["Pageindex"] = page
        data, err = http_get_json(ZT_URL, params, referer=EM_ZT_REFERER)
        if err:
            return pool, err
        node = (data or {}).get("data") or {}
        if qdate is None:
            qdate = node.get("qdate")
        chunk = node.get("pool") or []
        if not chunk:
            break
        pool.extend(chunk)
        total = node.get("tc", 0) or 0
        if total and len(pool) >= total:
            break
        page += 1
    logging.getLogger(LOGGER_NAME).info(
        "涨停池主源: 日期 %s | 页数 %s | 累计 %s 条 | tc %s | qdate %s",
        parse_date(date_str), page + 1, len(pool), total, qdate,
    )
    return pool, ""


def _ths_time(value):
    try:
        stamp = int(str(value).strip())
    except (TypeError, ValueError):
        return ""
    if stamp <= 0:
        return ""
    return datetime.fromtimestamp(stamp, tz=CST).strftime("%H:%M:%S")


def fetch_zt_pool_ths(date_str):
    params = {
        "page": 1,
        "limit": THS_PAGE_SIZE,
        "field": THS_FIELDS,
        "sort_field": "199112",
        "sort_order": "desc",
        "date": parse_date(date_str).replace("-", ""),
        "keepField": "",
    }
    time.sleep(random.uniform(*FALLBACK_SLEEP))
    data, err = http_get_json(THS_URL, params, referer=THS_REFERER)
    if err:
        return [], err
    if not isinstance(data, dict):
        return [], "同花顺返回非字典结构"
    if data.get("status_code") != 0:
        return [], "同花顺返回错误 {}: {}".format(
            data.get("status_code"), data.get("status_msg") or ""
        ).strip()
    node = data.get("data")
    if not isinstance(node, dict):
        return [], "同花顺返回缺少 data 节点"
    rows = node.get("info")
    if not isinstance(rows, list):
        return [], "同花顺返回 data.info 非列表"
    if not rows:
        return [], "同花顺返回 0 条"
    out = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        code = norm_code(item.get("code"))
        if not code:
            continue
        out.append({
            "c": code,
            "n": item.get("name"),
            "zttj": item.get("high_days"),
            "fbt": _ths_time(item.get("first_limit_up_time")),
            "hybk": "",
            "reason": item.get("reason_type"),
        })
    if not out:
        return [], "同花顺返回 {} 条但无可解析代码".format(len(rows))
    return out, ""


def fetch_ths_reasons(date_str):
    rows, err = fetch_zt_pool_ths(date_str)
    if err:
        return {}, err
    mapping = {}
    for item in rows:
        code = norm_code(item.get("c"))
        reason = str(item.get("reason") or "").strip()
        if code and reason:
            mapping[code] = reason
    return mapping, ""


def _board_text(item, stats):
    zttj = item.get("zttj")
    if isinstance(zttj, dict):
        text = fmt_board_count(zttj.get("days"), zttj.get("ct"))
        if text:
            return text
    elif isinstance(zttj, str) and zttj.strip():
        text = zttj.strip()
        if text == "首板":
            return fmt_board_count(1, 1)
        if re.search(r"\d+天\d+板", text):
            return text
    try:
        value = int(item.get("lbc"))
    except (TypeError, ValueError):
        value = 0
    if value > 0:
        stats["board_fallback"] += 1
        return "{}板".format(value)
    return ""


def normalize_zt(raw):
    stats = {"board_fallback": 0, "duplicated": 0, "dropped": 0}
    seen = set()
    rows = []
    for item in raw or []:
        if not isinstance(item, dict):
            stats["dropped"] += 1
            continue
        code = norm_code(item.get("c"))
        if not code:
            stats["dropped"] += 1
            continue
        if code in seen:
            stats["duplicated"] += 1
            continue
        seen.add(code)
        rows.append({
            "板数": _board_text(item, stats),
            "代码": code,
            "名称": str(item.get("n") or "").strip(),
            "时间": fmt_time(item.get("fbt")),
            "主线板块": str(item.get("hybk") or "").strip(),
            "涨停原因": str(item.get("reason") or "").strip(),
            "_seal_amount": item.get("fund"),
        })
    return pd.DataFrame(
        rows, columns=list(ZT_COLUMNS) + ["_seal_amount"]
    ), stats


def _count_reason(df):
    if df is None or len(df) == 0 or "涨停原因" not in df.columns:
        return 0
    return int(sum(
        1 for v in df["涨停原因"].tolist() if str(v or "").strip()
    ))


def _m_of(text):
    matched = re.search(r"(\d+)天(\d+)板", str(text or ""))
    return int(matched.group(2)) if matched else 0


def sort_pool(df):
    if df is None or len(df) == 0:
        return df
    ordered = df.copy()
    ordered["_m"] = ordered["板数"].map(_m_of)
    ordered["_t"] = ordered["时间"].map(lambda v: v or "99:99:99")
    ordered = ordered.sort_values(
        ["_m", "_t"], ascending=[False, True], kind="mergesort"
    )
    ordered = ordered.drop(columns=["_m", "_t"]).reset_index(drop=True)
    return ordered[list(ZT_COLUMNS) + ["_seal_amount"]]


def _clean_reason_text(text):
    value = str(text or "")
    for token in ("、", "，", ","):
        value = value.replace(token, REASON_SEPARATOR)
    parts = [p.strip() for p in value.split(REASON_SEPARATOR)]
    return REASON_SEPARATOR.join([p for p in parts if p])


def split_tags(reason):
    return [p for p in _clean_reason_text(reason).split(REASON_SEPARATOR) if p]


def _theme_type(name, themes):
    for word in themes.get("event") or []:
        if name == str(word).strip():
            return THEME_TYPE_PREFIX
    return "sector"


def normalize_themes(themes):
    canonical = {}
    raw_canonical = themes.get("canonical") or {}
    for key, value in raw_canonical.items():
        name = str(key).strip()
        if not name:
            continue
        if isinstance(value, (list, tuple)):
            canonical[name] = [str(v).strip() for v in value if str(v).strip()]
        else:
            alias = str(value).strip() or name
            canonical.setdefault(alias, []).append(name)
            if alias == name:
                canonical.setdefault(name, [])
            if name not in canonical[alias]:
                canonical[alias].append(name)
    sentiment = {}
    raw_sentiment = themes.get("sentiment") or {}
    if isinstance(raw_sentiment, dict):
        for key, value in raw_sentiment.items():
            name = str(key).strip()
            if not name:
                continue
            words = value if isinstance(value, (list, tuple)) else [value]
            sentiment[name] = [str(w).strip() for w in words if str(w).strip()]
    event, ignore, reasons = [], [], {}
    for item in themes.get("event") or []:
        text = str(item).strip()
        if text and text not in event:
            event.append(text)
    for item in themes.get("ignore") or []:
        text = str(item).strip()
        if text and text not in ignore:
            ignore.append(text)
    for key, value in (themes.get("reasons") or {}).items():
        text = str(key).strip()
        if text:
            reasons[text] = str(value).strip()
    return {
        "canonical": canonical,
        "event": event,
        "ignore": ignore,
        "reasons": reasons,
        "sentiment": sentiment,
    }


def resolve_theme(raw_theme, themes):
    source = str(raw_theme or "").strip()
    canonical = themes.get("canonical") or {}
    for name, aliases in canonical.items():
        target = str(name).strip()
        if isinstance(aliases, (list, tuple)):
            if source in [str(a).strip() for a in aliases]:
                return (target or THEME_OTHER), _theme_type(target, themes)
        elif source == target:
            return (str(aliases).strip() or THEME_OTHER), "sector"
    if source in (themes.get("event") or []):
        return source, THEME_TYPE_PREFIX
    return THEME_OTHER, "other"


def resolve_sentiment(raw_theme, reason, themes):
    source = str(raw_theme or "").strip()
    text = str(reason or "")
    for name, words in (themes.get("sentiment") or {}).items():
        for word in words:
            if word and (word == source or word in text):
                return str(name).strip(), THEME_SENTIMENT
    return None


def strip_ignore(text, ignore):
    value = _clean_reason_text(text)
    for word in ignore or []:
        word = str(word).strip()
        if word:
            value = value.replace(word, REASON_SEPARATOR)
    return _clean_reason_text(value)


def _board_count(text):
    matched = re.search(r"(\d+)天(\d+)板", str(text or ""))
    if matched:
        value = int(matched.group(2))
        if value >= 1:
            return value
    matched = re.search(r"(\d+)板", str(text or ""))
    if matched:
        value = int(matched.group(1))
        if value >= 1:
            return value
    return 1


def _transition(text):
    value = str(text or "").strip().replace(",", "").replace("，", "").replace("元", "")
    factor = 1.0
    if value.endswith("亿"):
        factor = 1e8
        value = value[:-1]
    elif value.endswith("万"):
        factor = 1e4
        value = value[:-1]
    if not value:
        return 0
    try:
        result = int(round(float(value) * factor))
    except (TypeError, ValueError, OverflowError):
        return 0
    return result if result > 0 else 0


def _seal_amount(value):
    amount = _transition(value)
    return amount if amount > 0 else 0


def _theme_reason(name, themes, theme_reasons):
    reason = str(theme_reasons.get(name) or "").strip()
    if reason:
        return reason, False
    return "{}{}".format(name, THEME_REASON_SUFFIX), True


def build_json_payload(df, target, themes, theme_reasons, seal_source="fund"):
    logger = logging.getLogger(LOGGER_NAME)
    themes = normalize_themes(themes)
    theme_order = []
    theme_type = {}

    def add_theme(name, kind):
        if name in theme_type:
            return
        theme_order.append(name)
        theme_type[name] = kind

    stocks = []
    stats = {
        "stocks": 0,
        "missing_seal": 0,
        "reason_unknown": 0,
        "theme_other": 0,
        "theme_sentiment": 0,
        "ignore_hits": 0,
        "theme_unmapped": [],
        "is_delisting": 0,
    }

    if df is not None:
        for row in df.to_dict("records"):
            code = norm_code(row.get("代码"))
            if not code:
                continue
            name = str(row.get("名称") or "").strip()
            if not name:
                continue
            theme, kind = resolve_theme(row.get("主线板块"), themes)
            if kind == "other":
                hit = resolve_sentiment(
                    row.get("主线板块"), row.get("涨停原因"), themes)
                if hit:
                    theme, kind = hit
                    stats["theme_sentiment"] += 1
            add_theme(theme, kind)
            if kind == "other":
                stats["theme_other"] += 1
            if theme == THEME_OTHER:
                raw = str(row.get("主线板块") or "").strip()
                if raw and raw not in stats["theme_unmapped"]:
                    stats["theme_unmapped"].append(raw)

            amount = _seal_amount(row.get("_seal_amount"))
            if amount <= 0:
                stats["missing_seal"] += 1
                amount = 1

            reason = strip_ignore(row.get("涨停原因"), themes.get("ignore"))
            if reason != _clean_reason_text(row.get("涨停原因")):
                stats["ignore_hits"] += 1
            if not reason:
                reason = REASON_UNKNOWN
                stats["reason_unknown"] += 1
            tags = split_tags(reason) or [reason]

            is_delisting = "退" in name
            if is_delisting:
                stats["is_delisting"] += 1

            stock = {
                "code": code,
                "name": name,
                "board_count": _board_count(row.get("板数")),
                "seal_time": str(row.get("时间") or "").strip(),
                "seal_amount": amount,
                "theme": theme,
                "reason": reason,
                "tags": tags,
                "is_delisting": is_delisting,
            }
            stocks.append(stock)

    add_theme(THEME_OTHER, "other")

    prefix = {"sector": 0, THEME_SENTIMENT: 1, THEME_TYPE_PREFIX: 2, "other": 3}
    ordered = sorted(theme_order, key=lambda n: (prefix[theme_type[n]],))
    themes_out = []
    pending = 0
    for name in ordered:
        reason, is_placeholder = _theme_reason(name, themes, theme_reasons)
        pending += 1 if is_placeholder else 0
        themes_out.append({
            "name": name,
            "type": theme_type[name],
            "reason": reason,
        })
    stats["theme_reason_pending"] = pending
    stats["themes"] = len(themes_out)
    stats["stocks"] = len(stocks)

    payload = {
        "schema_version": SCHEMA_VERSION,
        "trade_date": parse_date(target),
        "themes": themes_out,
        "stocks": stocks,
    }

    if stats["missing_seal"]:
        logger.warning(
            "封板资金字段 %s 缺失或非正，已按 1 兜底 %s 条（占比 %.1f%%）",
            seal_source, stats["missing_seal"],
            stats["missing_seal"] * 100.0 / max(1, stats["stocks"]),
        )
    if stats["reason_unknown"]:
        logger.warning("涨停原因为空，已填 %s 的条数: %s",
                       REASON_UNKNOWN, stats["reason_unknown"])
    if stats["theme_unmapped"]:
        logger.warning("题材未命中字典（已归入 %s）共 %s 个: %s",
                       THEME_OTHER, len(stats["theme_unmapped"]),
                       "、".join(stats["theme_unmapped"]))
    if stats["theme_sentiment"]:
        logger.info("情绪题材关键词命中 %s 条", stats["theme_sentiment"])
    if stats["ignore_hits"]:
        logger.info("噪声词已从涨停原因中剔除 %s 条", stats["ignore_hits"])
    if pending:
        logger.warning(
            "题材驱动逻辑未审校 %s 个，已用占位文本，待补 themes.json 的 reasons 段",
            pending,
        )
    return payload, stats


def _window_anchor():
    calendar = load_trade_calendar()
    ordered = sorted(calendar)
    if not ordered:
        return ordered, -1
    today = date.today().strftime("%Y-%m-%d")
    ref = prev_trade_date(today)
    pos = bisect_left(ordered, ref)
    if pos >= len(ordered) or ordered[pos] != ref:
        return ordered, len(ordered) - 1
    return ordered, pos


def window_bounds():
    ordered, ref_pos = _window_anchor()
    if ref_pos < 0:
        return "", ""
    start = max(0, ref_pos - ZT_WINDOW_DAYS + 1)
    return ordered[start], ordered[ref_pos]


def assert_in_window(date_str):
    target = parse_date(date_str)
    ordered, ref_pos = _window_anchor()
    if ref_pos < 0:
        raise DataNotReadyError("交易日历为空，无法判断东财保留窗口")
    pos = bisect_left(ordered, target)
    if pos >= len(ordered) or ordered[pos] != target:
        if target > ordered[-1]:
            logging.getLogger(LOGGER_NAME).warning(
                "交易日历仅覆盖至 %s，%s 超出日历范围，跳过窗口校验",
                ordered[-1], target,
            )
            return target
        raise DataNotReadyError(
            "{} 不在交易日历内，无法判断是否超出东财保留窗口".format(target)
        )
    offset = ref_pos - pos + 1
    if offset <= 0:
        raise DataNotReadyError(
            "{} 晚于当前交易日 {}，数据尚未发布".format(target, ordered[ref_pos])
        )
    if offset > ZT_WINDOW_DAYS:
        earliest, last = window_bounds()
        raise DataNotReadyError(
            "{} 超出东财涨停池保留窗口：仅支持最近约 {} 个交易日"
            "（当前可用 {} ~ {}）".format(
                target, ZT_WINDOW_DAYS, earliest, last
            )
        )
    return target


def run(date_str, boards=DEFAULT_BOARDS, drop_st=True, fallback=True,
        fill_reason=True, outdir=DATA_DIR, json_out=False):
    logger = setup_logger(LOGGER_NAME)
    started = time.time()
    target = parse_date(date_str)

    raw, err = fetch_zt_pool(target)
    if err:
        logger.warning("涨停池主源失败: %s", err)

    fallback_used = False
    if err or not raw:
        assert_in_window(target)
        if fallback:
            logger.info("涨停池主源为空，尝试同花顺兜底")
            ths_rows, ths_err = fetch_zt_pool_ths(target)
            if ths_rows:
                raw, err = ths_rows, ""
                fallback_used = True
                logger.warning("涨停池使用同花顺兜底，共 %s 条", len(ths_rows))
            else:
                logger.warning("涨停池兜底不可用: %s", ths_err or "返回 0 条")

    if not raw:
        raise SourceUnavailableError(
            "{} 涨停池无数据（主源与兜底均不可用）".format(target)
        )

    df, norm_stats = normalize_zt(raw)
    if norm_stats["duplicated"]:
        logger.info("涨停池按代码去重，丢弃重复 %s 条", norm_stats["duplicated"])
    if norm_stats["board_fallback"]:
        logger.info("板数字段降级使用 lbc 的条数: %s", norm_stats["board_fallback"])
    if norm_stats["dropped"]:
        logger.warning("涨停池丢弃无法解析的记录 %s 条", norm_stats["dropped"])

    raw_count = len(df)
    df = filter_boards(df, boards, "代码")
    board_filtered = len(df)
    if drop_st:
        df = filter_st(df, "名称")
    st_filtered = len(df)

    reason_filled = 0
    if fill_reason and fallback:
        if fallback_used:
            reason_filled = _count_reason(df)
            logger.info(
                "涨停原因来自同花顺兜底自带: 已填充 %s 条", reason_filled
            )
        else:
            mapping, reason_err = fetch_ths_reasons(target)
            if mapping:
                df["涨停原因"] = df["代码"].map(lambda c: mapping.get(c, ""))
                df["涨停原因"] = df["涨停原因"].fillna("")
                reason_filled = _count_reason(df)
                logger.info(
                    "涨停原因由同花顺补充 %s / %s 条（口径=同花顺涨停原因）",
                    reason_filled, len(df),
                )
            else:
                logger.warning(
                    "涨停原因补充不可用，第 6 列保持空串: %s",
                    reason_err or "无可用数据",
                )

    df = sort_pool(df)
    final_count = len(df)

    excel_df = df[list(ZT_COLUMNS)]
    path = save_excel(excel_df, KIND_LIMIT_UP, target, outdir=outdir)

    json_path = ""
    json_stats = {}
    if json_out:
        themes = load_themes(outdir=outdir)
        theme_reasons = themes.get("reasons") or {}
        payload, json_stats = build_json_payload(df, target, themes, theme_reasons)
        json_path = save_json(payload, KIND_LIMIT_UP, target, outdir=outdir)
        # 待审题材候选清单已改由 theme_review.py propose 统一生成，
        # 原 write_theme_candidates 写入的 themes.candidates.json 已废弃移除
        logger.info(
            "涨停池 JSON 已写入 %s（题材 %s / 个股 %s / 缺失封单 %s / 待审题材 %s）",
            json_path, json_stats.get("themes"), json_stats.get("stocks"),
            json_stats.get("missing_seal"),
            json_stats.get("theme_reason_pending"),
        )

    elapsed = round(time.time() - started, 2)

    logger.info(
        "涨停池完成: 原始 %s → 板块 %s → 剔除ST %s → 涨停原因 %s → 输出 %s"
        " | %s | %.2fs",
        raw_count, board_filtered, st_filtered, reason_filled, final_count,
        path, elapsed,
    )

    return {
        "kind": KIND_LIMIT_UP,
        "date": target,
        "raw_count": raw_count,
        "board_filtered": board_filtered,
        "st_filtered": st_filtered,
        "final_count": final_count,
        "fallback_used": fallback_used,
        "fallback_supplement": reason_filled,
        "reason_filled": reason_filled,
        "failed_count": 0,
        "board_fallback": norm_stats["board_fallback"],
        "duplicated": norm_stats["duplicated"],
        "path": path,
        "json_path": json_path,
        "json_stats": json_stats,
        "elapsed": elapsed,
    }