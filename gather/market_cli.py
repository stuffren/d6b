import argparse
import csv
import logging
import os
import sys
from datetime import datetime, timedelta, timezone

import common
import dragon_tiger
import limit_up
from common import (
    BOARD_ENUM,
    DEFAULT_BOARDS,
    DataNotReadyError,
    NonTradeDateError,
    SourceUnavailableError,
    ensure_dirs,
    expand_range,
    is_done,
    mark_done,
    parse_date,
    prev_trade_date,
    setup_logger,
)

LOGGER_NAME = "market"
CST = timezone(timedelta(hours=8))
TIME_WINDOWS = {
    common.KIND_LIMIT_UP: (15, 30),
    common.KIND_DRAGON_TIGER: (18, 0),
}
KIND_ALIAS = {
    "limit-up": common.KIND_LIMIT_UP,
    "lhb": common.KIND_DRAGON_TIGER,
}


class CliError(Exception):
    pass


def _now_cst():
    return datetime.now(tz=CST)


def window_deadline(kind):
    hour, minute = TIME_WINDOWS[kind]
    now = _now_cst()
    return now.replace(hour=hour, minute=minute, second=0, microsecond=0)


def window_reached(kind, date_str):
    now = _now_cst()
    target = parse_date(date_str)
    today = now.strftime("%Y-%m-%d")
    if target < today:
        return True
    if target > today:
        return False
    return now >= window_deadline(kind)


def window_text(kind, date_str):
    hour, minute = TIME_WINDOWS[kind]
    return "{} {}:{}".format(parse_date(date_str), "{:02d}".format(hour),
                             "{:02d}".format(minute))


def _parse_boards(value):
    tokens = [t.strip().upper() for t in str(value or "").split(",") if t.strip()]
    if not tokens:
        raise CliError("--boards 不能为空")
    invalid = [t for t in tokens if t not in BOARD_ENUM]
    if invalid:
        raise CliError(
            "--boards 含未知板块: {}（可选: {}）".format(
                ",".join(invalid), ",".join(BOARD_ENUM))
        )
    ordered = []
    for token in tokens:
        if token not in ordered:
            ordered.append(token)
    return tuple(ordered)


def _add_common(parser):
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--date", help="单日日期，支持 20261102 / 2026-11-02")
    group.add_argument("--start", help="区间起始日（需与 --end 成对）")
    parser.add_argument("--end", help="区间结束日（需与 --start 成对）")
    parser.add_argument(
        "--boards", default=",".join(DEFAULT_BOARDS),
        help="板块过滤，逗号分隔，可选: " + ",".join(BOARD_ENUM),
    )
    st_group = parser.add_mutually_exclusive_group()
    st_group.add_argument("--no-st", dest="drop_st", action="store_true",
                          default=True, help="剔除 ST（默认）")
    st_group.add_argument("--keep-st", dest="drop_st", action="store_false",
                          help="保留 ST")
    parser.add_argument("--fallback", choices=("on", "off"), default="on",
                        help="兜底开关，默认 on")
    parser.add_argument("--force", action="store_true",
                        help="忽略时间窗与已完成记录，强制重跑")
    parser.add_argument("--outdir", default=common.DATA_DIR,
                        help="输出根目录，默认 data")
    parser.add_argument("--json", dest="json_out", action="store_true",
                        default=False,
                        help="额外输出契约 JSON（data/<kind>/YYYY-MM-DD.json）")


def build_parser():
    parser = argparse.ArgumentParser(
        prog="market_cli.py",
        description="A 股涨停池与龙虎榜采集",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_zt = sub.add_parser("limit-up", help="采集涨停池（6 列）")
    _add_common(p_zt)
    p_zt.add_argument("--no-reason", dest="fill_reason", action="store_false",
                      default=True, help="跳过同花顺涨停原因补齐")

    p_lhb = sub.add_parser("lhb", help="采集龙虎榜（19 列）")
    _add_common(p_lhb)
    p_lhb.add_argument("--layout", choices=("combo", "split"), default="combo",
                       help="输出布局，默认 combo")
    p_lhb.add_argument("--keep-reason", action="store_true",
                       help="保留全部上榜原因（默认聚合）")
    return parser


def resolve_dates(args):
    if args.start or args.end:
        if not args.start or not args.end:
            raise CliError("--start 与 --end 必须成对使用")
        try:
            dates = expand_range(args.start, args.end)
        except ValueError as exc:
            raise CliError(str(exc))
        return dates, True
    if args.date:
        return [parse_date(args.date)], False
    return [prev_trade_date()], False


def _make_runner(kind, args):
    boards = args.boards
    drop_st = args.drop_st
    fallback = args.fallback == "on"
    if kind == common.KIND_LIMIT_UP:
        def run_one(date_str):
            return limit_up.run(
                date_str, boards=boards, drop_st=drop_st, fallback=fallback,
                fill_reason=args.fill_reason, outdir=args.outdir,
                json_out=args.json_out,
            )
        return run_one

    def run_one(date_str):
        return dragon_tiger.run(
            date_str, boards=boards, drop_st=drop_st, fallback=fallback,
            layout=args.layout, keep_reason=args.keep_reason,
            outdir=args.outdir, json_out=args.json_out,
        )
    return run_one


def _summary_path(kind, start, end, outdir):
    log_dir = os.path.join(outdir, "logs")
    os.makedirs(log_dir, exist_ok=True)
    return os.path.join(log_dir, "summary_{}_{}_{}.csv".format(kind, start, end))


def _write_summary(kind, start, end, records, outdir):
    if not records:
        return ""
    path = _summary_path(kind, start, end, outdir)
    fieldnames = []
    for row in records:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)
    return path


def _one_line(stats):
    return ("{} | 原始 {} → 板块 {} → 剔除ST {} → 输出 {}".format(
        stats.get("date"), stats.get("raw_count"),
        stats.get("board_filtered"), stats.get("st_filtered"),
        stats.get("final_count"),
    ))


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    ensure_dirs(outdir=args.outdir)
    logger = setup_logger(LOGGER_NAME,
                          log_dir=os.path.join(args.outdir, "logs"))

    kind = KIND_ALIAS[args.cmd]
    try:
        boards = _parse_boards(args.boards)
    except CliError as exc:
        logger.error("%s", exc)
        return 2
    args.boards = boards

    try:
        dates, ranged = resolve_dates(args)
    except (CliError, ValueError) as exc:
        logger.error("日期参数错误: %s", exc)
        return 2

    fallback_text = "on" if args.fallback == "on" else "off"
    logger.info(
        "启动: %s | 日期 %s | 板块 %s | ST %s | 兜底 %s | force %s",
        kind, ",".join(dates), ",".join(boards),
        "剔除" if args.drop_st else "保留", fallback_text, args.force,
    )
    if not ranged and dates:
        logger.info("时间窗: %s 之前跳过（--force 可放行）",
                    window_text(kind, dates[0]))

    run_one = _make_runner(kind, args)
    succeeded = []
    failed = []
    skipped = []

    for date_str in dates:
        try:
            target = common.assert_trade_date(date_str)
        except NonTradeDateError as exc:
            if not ranged:
                logger.error("%s", exc)
                return 2
            logger.warning("%s 跳过", exc)
            skipped.append({"date": parse_date(date_str), "reason": "非交易日"})
            continue
        except SourceUnavailableError as exc:
            logger.error("交易日历不可用: %s", exc)
            if not ranged:
                return 2
            skipped.append({"date": parse_date(date_str), "reason": "交易日历不可用"})
            continue

        if not args.force and not window_reached(kind, target):
            logger.warning(
                "%s 时间窗未到（%s 之后才可信），跳过；如需强制请加 --force",
                target, window_text(kind, target),
            )
            skipped.append({"date": target, "reason": "时间窗未到"})
            continue

        if not args.force and is_done(kind, target, outdir=args.outdir):
            logger.info("%s 已完成，跳过；如需重跑请加 --force", target)
            skipped.append({"date": target, "reason": "已完成"})
            continue

        if args.force:
            common.clear_done(kind, target, outdir=args.outdir)
            logger.info("%s 强制重跑，已清除完成标记", target)

        try:
            stats = run_one(target)
        except DataNotReadyError as exc:
            logger.error("%s 数据窗口不可用: %s", target, exc)
            failed.append({"date": target, "reason": "数据窗口不可用"})
            continue
        except SourceUnavailableError as exc:
            logger.error("%s 数据源不可用: %s", target, exc)
            failed.append({"date": target, "reason": "数据源不可用"})
            continue
        except Exception as exc:
            logger.exception("%s 采集异常: %s", target, exc)
            failed.append({"date": target, "reason": "采集异常: {}".format(exc)})
            continue

        mark_done(kind, target, outdir=args.outdir)
        succeeded.append(stats)
        logger.info("完成: %s", _one_line(stats))

    if ranged and dates:
        records = []
        for stats in succeeded:
            records.append({k: v for k, v in stats.items()})
        for row in failed:
            records.append({"date": row["date"], "reason": row["reason"],
                            "status": "failed"})
        for row in skipped:
            records.append({"date": row["date"], "reason": row["reason"],
                            "status": "skipped"})
        path = _write_summary(kind, dates[0], dates[-1], records, args.outdir)
        if path:
            logger.info("区间汇总已写入 %s（成功 %s / 失败 %s / 跳过 %s）",
                        path, len(succeeded), len(failed), len(skipped))

    logger.info("结束: %s 成功 %s / 失败 %s / 跳过 %s，共 %s 个日期",
                kind, len(succeeded), len(failed), len(skipped), len(dates))

    if failed:
        return 1
    if succeeded or skipped:
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())