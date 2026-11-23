import os
import re
import json
import time
import logging
import threading
from datetime import datetime, date, timedelta

import pandas as pd
import requests
import akshare as ak

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://quote.eastmoney.com/",
}

EM_ZT_UT = "7eea3edcaed734bea9cbfc24409ed989"
EM_DATACENTER_REFERER = "https://data.eastmoney.com/"
EM_ZT_REFERER = "https://quote.eastmoney.com/"
SSE_REFERER = "http://www.sse.com.cn/"
SZSE_REFERER = "http://www.szse.cn/"

HTTP_TIMEOUT = 10
HTTP_RETRIES = 3
HTTP_BACKOFF = (0.5, 1.5, 2.5)
LHB_WORKERS = 8
PAGE_SIZE_ZT = 170
PAGE_SIZE_LHB = 500
PAGE_SIZE_SEAT = 20
SEAT_AMT_UNIT = 1
MAX_PAGES = 20
FALLBACK_SLEEP = (1.0, 2.0)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
LOG_DIR = os.path.join(BASE_DIR, "logs")
STATE_FILE = os.path.join(DATA_DIR, ".state.json")
CALENDAR_FILE = os.path.join(DATA_DIR, ".trade_cal.csv")
CALENDAR_TTL_DAYS = 7

KIND_LIMIT_UP = "limit_up"
KIND_DRAGON_TIGER = "dragon_tiger"
KINDS = (KIND_LIMIT_UP, KIND_DRAGON_TIGER)

DEFAULT_BOARDS = ("SH_MAIN", "SZ_MAIN", "GEM", "STAR")
BOARD_ENUM = ("SH_MAIN", "SZ_MAIN", "GEM", "STAR", "BJ", "B", "OTHER")

EMPTY_TOKENS = ("", "-", "--", "—", "None", "none", "nan", "NaN", "null", "NULL")

_local = threading.local()
_TRADE_CAL = None


class NonTradeDateError(Exception):
    pass


class DataNotReadyError(Exception):
    pass


class SourceUnavailableError(Exception):
    pass


def ensure_dirs(outdir=DATA_DIR, log_dir=LOG_DIR):
    for path in (outdir, log_dir,
                 os.path.join(outdir, KIND_LIMIT_UP),
                 os.path.join(outdir, KIND_DRAGON_TIGER)):
        os.makedirs(path, exist_ok=True)
    return outdir


def setup_logger(name="market", log_dir=None, level=logging.INFO):
    logger = logging.getLogger(name)
    if getattr(logger, "_market_configured", False):
        return logger
    log_dir = log_dir or LOG_DIR
    os.makedirs(log_dir, exist_ok=True)
    logger.setLevel(level)
    logger.propagate = False
    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    file_handler = logging.FileHandler(
        os.path.join(log_dir, "market_{}.log".format(datetime.now().strftime("%Y%m%d"))),
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)
    logger.addHandler(file_handler)
    logger._market_configured = True
    return logger


def get_session(referer=None):
    sessions = getattr(_local, "sessions", None)
    if sessions is None:
        sessions = {}
        _local.sessions = sessions
    key = referer or ""
    if key not in sessions:
        session = requests.Session()
        session.headers.update(HEADERS)
        if referer:
            session.headers["Referer"] = referer
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=LHB_WORKERS, pool_maxsize=LHB_WORKERS * 2
        )
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        sessions[key] = session
    return sessions[key]


def http_get_json(url, params=None, referer=None, retries=HTTP_RETRIES, timeout=HTTP_TIMEOUT):
    last_err = ""
    for attempt in range(max(1, retries)):
        try:
            resp = get_session(referer).get(url, params=params, timeout=timeout)
            if resp.status_code != 200:
                last_err = "HTTP {}".format(resp.status_code)
            else:
                data = resp.json()
                if isinstance(data, (dict, list)):
                    return data, ""
                last_err = "响应不是 JSON 对象"
        except Exception as exc:
            last_err = "{}: {}".format(type(exc).__name__, exc)
        if attempt < retries - 1:
            time.sleep(HTTP_BACKOFF[min(attempt, len(HTTP_BACKOFF) - 1)])
    return None, last_err or "请求失败"


def find_key(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for value in obj.values():
            found = find_key(value, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = find_key(value, key)
            if found is not None:
                return found
    return None


def norm_code(code):
    if code is None:
        return ""
    digits = re.sub(r"\D", "", str(code))
    if not digits:
        return ""
    return digits[-6:].zfill(6)


def code_board(code):
    c = norm_code(code)
    if len(c) != 6:
        return "OTHER"
    if c.startswith("920"):
        return "BJ"
    if c.startswith(("600", "601", "603", "605")):
        return "SH_MAIN"
    if c.startswith(("688", "689")):
        return "STAR"
    if c.startswith(("000", "001", "002", "003")):
        return "SZ_MAIN"
    if c.startswith(("300", "301")):
        return "GEM"
    if c.startswith(("900", "200")):
        return "B"
    if c[0] in ("8", "4"):
        return "BJ"
    return "OTHER"


def filter_boards(df, keep=DEFAULT_BOARDS, code_col="代码"):
    if df is None or len(df) == 0:
        return df
    keep_set = set(keep)
    mask = df[code_col].map(lambda v: code_board(v) in keep_set)
    return df[mask].reset_index(drop=True)


def is_st(name):
    if name is None:
        return False
    text = str(name).strip().upper()
    if not text:
        return False
    return "ST" in text


def filter_st(df, name_col="名称"):
    if df is None or len(df) == 0:
        return df
    mask = df[name_col].map(lambda v: not is_st(v))
    return df[mask].reset_index(drop=True)


def parse_date(value):
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    digits = re.sub(r"\D", "", text)
    if len(digits) != 8:
        raise ValueError("无法解析日期: {}".format(value))
    parsed = datetime.strptime(digits, "%Y%m%d")
    return parsed.strftime("%Y-%m-%d")


def load_trade_calendar(ttl_days=CALENDAR_TTL_DAYS):
    global _TRADE_CAL
    if _TRADE_CAL:
        return _TRADE_CAL
    ensure_dirs()
    dates = None
    if os.path.exists(CALENDAR_FILE):
        age = time.time() - os.path.getmtime(CALENDAR_FILE)
        if age < ttl_days * 86400:
            try:
                cached = pd.read_csv(CALENDAR_FILE, dtype=str)
                dates = [str(v)[:10] for v in cached.iloc[:, 0].tolist()]
            except Exception:
                dates = None
    if not dates:
        try:
            raw = ak.tool_trade_date_hist_sina()
            col = "trade_date" if "trade_date" in raw.columns else raw.columns[0]
            dates = [str(v)[:10] for v in raw[col].tolist()]
            pd.DataFrame({"trade_date": dates}).to_csv(
                CALENDAR_FILE, index=False, encoding="utf-8"
            )
        except Exception as exc:
            raise SourceUnavailableError("交易日历获取失败: {}".format(exc))
    _TRADE_CAL = set(dates)
    return _TRADE_CAL


def _calendar_max(calendar=None):
    calendar = calendar if calendar is not None else load_trade_calendar()
    return max(calendar) if calendar else ""


def _beyond_calendar(target, calendar):
    last = _calendar_max(calendar)
    return bool(last) and target > last


def _roll_back_weekend(target):
    cursor = datetime.strptime(target, "%Y-%m-%d").date()
    while cursor.weekday() >= 5:
        cursor -= timedelta(days=1)
    return cursor.strftime("%Y-%m-%d")


def assert_trade_date(value):
    target = parse_date(value)
    calendar = load_trade_calendar()
    if target in calendar:
        return target
    if _beyond_calendar(target, calendar):
        fallback = _roll_back_weekend(target)
        if fallback == target:
            logging.getLogger("market").warning(
                "交易日历仅覆盖至 %s，%s 按工作日放行", _calendar_max(calendar), target
            )
            return target
        raise NonTradeDateError("{} 非交易日（日历未覆盖，按周末判定）".format(target))
    raise NonTradeDateError("{} 非交易日".format(target))


def prev_trade_date(value=None):
    target = parse_date(value) if value is not None else date.today().strftime("%Y-%m-%d")
    calendar = load_trade_calendar()
    if target in calendar:
        return target
    if _beyond_calendar(target, calendar):
        fallback = _roll_back_weekend(target)
        logging.getLogger("market").warning(
            "交易日历仅覆盖至 %s，%s 按工作日判定为 %s",
            _calendar_max(calendar), target, fallback,
        )
        return fallback
    cursor = datetime.strptime(target, "%Y-%m-%d").date()
    for _ in range(60):
        cursor -= timedelta(days=1)
        current = cursor.strftime("%Y-%m-%d")
        if current in calendar:
            return current
    raise NonTradeDateError("{} 之前 60 天内无交易日".format(target))


def expand_range(start, end):
    start_date = parse_date(start)
    end_date = parse_date(end)
    if end_date < start_date:
        raise ValueError("end 必须大于等于 start")
    cursor = datetime.strptime(start_date, "%Y-%m-%d").date()
    limit = datetime.strptime(end_date, "%Y-%m-%d").date()
    days = []
    while cursor <= limit:
        days.append(cursor.strftime("%Y-%m-%d"))
        cursor += timedelta(days=1)
    return days


def parse_amount(value):
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        try:
            if pd.isna(value):
                return 0.0
        except Exception:
            return 0.0
        return float(value)
    text = str(value).strip().replace(",", "").replace("，", "").replace("元", "")
    if text in EMPTY_TOKENS:
        return 0.0
    factor = 1.0
    if text.endswith("亿"):
        factor = 1e8
        text = text[:-1]
    elif text.endswith("万"):
        factor = 1e4
        text = text[:-1]
    text = text.strip()
    try:
        return float(text) * factor
    except ValueError:
        return 0.0


def parse_pct(value):
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        try:
            if pd.isna(value):
                return 0.0
        except Exception:
            return 0.0
        return float(value)
    text = str(value).strip().replace("%", "").replace("％", "").replace(",", "")
    if text in EMPTY_TOKENS:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def fmt_time(value):
    if value is None:
        return ""
    if isinstance(value, str):
        text = value.strip()
        if text in EMPTY_TOKENS:
            return ""
        if ":" in text:
            return text
        digits = re.sub(r"\D", "", text)
    else:
        try:
            digits = str(int(value))
        except Exception:
            return ""
    if not digits:
        return ""
    digits = digits.zfill(6)
    if digits == "000000":
        return ""
    return "{}:{}:{}".format(digits[0:2], digits[2:4], digits[4:6])


def fmt_seat(name, amount_yuan):
    seat = str(name or "").strip()
    amount = parse_amount(amount_yuan)
    if not seat or amount <= 0:
        return ""
    return "{}｜{:.2f}".format(seat, amount / 10000.0)


def fmt_board_count(days, times):
    try:
        day_value = int(days)
        time_value = int(times)
    except Exception:
        return ""
    if day_value <= 0 or time_value <= 0:
        return ""
    return "{}天{}板".format(day_value, time_value)


def save_excel(df, kind, date_str, outdir=DATA_DIR, meta=None):
    ensure_dirs(outdir=outdir)
    target_dir = os.path.join(outdir, kind)
    os.makedirs(target_dir, exist_ok=True)
    path = os.path.join(target_dir, "{}.xlsx".format(parse_date(date_str)))
    sheet = str(kind)[:31] or "data"
    output = df.copy()
    output = output.fillna("")
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        output.to_excel(writer, index=False, sheet_name=sheet)
        if meta:
            props = writer.book.properties
            for key, value in meta.items():
                if hasattr(props, key):
                    try:
                        setattr(props, key, str(value))
                    except Exception:
                        pass
    return path


def _state_path(outdir=None):
    if outdir is None:
        return STATE_FILE
    return os.path.join(outdir, ".state.json")


def read_state(outdir=None):
    path = _state_path(outdir)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _write_state(state, outdir=None):
    base = outdir or DATA_DIR
    ensure_dirs(outdir=base)
    path = _state_path(outdir)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def is_done(kind, date_str, outdir=None):
    node = read_state(outdir=outdir).get(kind)
    if not isinstance(node, dict):
        return False
    return parse_date(date_str) in node


def mark_done(kind, date_str, outdir=None):
    state = read_state(outdir=outdir)
    node = state.get(kind)
    if not isinstance(node, dict):
        node = {}
        state[kind] = node
    node[parse_date(date_str)] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    _write_state(state, outdir=outdir)
    write_last_update(outdir=outdir)


def clear_done(kind, date_str=None, outdir=None):
    state = read_state(outdir=outdir)
    if date_str is None:
        state.pop(kind, None)
    else:
        node = state.get(kind)
        if isinstance(node, dict):
            node.pop(parse_date(date_str), None)
    _write_state(state, outdir=outdir)
    write_last_update(outdir=outdir)


def _data_dates(kind, outdir=None):
    base = outdir or DATA_DIR
    folder = os.path.join(base, kind)
    if not os.path.isdir(folder):
        return []
    dates = []
    for name in os.listdir(folder):
        if not name.endswith(".json"):
            continue
        stem = name[:-5]
        try:
            parse_date(stem)
        except Exception:
            continue
        dates.append(stem)
    return sorted(dates)


def build_last_update(outdir=None):
    base = outdir or DATA_DIR
    state = read_state(outdir=outdir)
    latest = ""
    latest_kind = ""
    latest_date = ""
    kinds = {}
    for kind in KINDS:
        node = state.get(kind)
        if not isinstance(node, dict):
            node = {}
        dates = _data_dates(kind, outdir=outdir)
        stamps = []
        for date_str in dates:
            stamp = node.get(date_str) or ""
            if not stamp:
                file_path = os.path.join(base, kind, date_str + ".json")
                try:
                    mtime = os.path.getmtime(file_path)
                    stamp = datetime.fromtimestamp(mtime).strftime("%Y-%m-%dT%H:%M:%S")
                except Exception:
                    stamp = ""
            if stamp:
                stamps.append(stamp)
        node_latest = max(stamps) if stamps else ""
        node_date = dates[-1] if dates else ""
        kinds[kind] = {
            "updated_at": node_latest,
            "latest_date": node_date,
            "days": len(dates),
            "in_state": len(node),
        }
        if node_latest > latest:
            latest = node_latest
            latest_kind = kind
            latest_date = node_date
    return {
        "updated_at": latest,
        "latest_date": latest_date,
        "latest_kind": latest_kind,
        "kinds": kinds,
    }


def write_last_update(outdir=None):
    payload = build_last_update(outdir=outdir)
    if not payload["updated_at"]:
        return ""
    base = outdir or DATA_DIR
    ensure_dirs(outdir=base)
    path = meta_path("last_update.json", outdir=base)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(tmp, path)
    return path


def write_failed(kind, date_str, rows, log_dir=None):
    if not rows:
        return ""
    log_dir = log_dir or LOG_DIR
    os.makedirs(log_dir, exist_ok=True)
    path = os.path.join(log_dir, "failed_{}_{}.csv".format(kind, parse_date(date_str)))
    pd.DataFrame(rows).to_csv(path, index=False, encoding="utf-8-sig")
    return path


def read_json(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


def save_json(payload, kind, date_str, outdir=DATA_DIR):
    ensure_dirs(outdir=outdir)
    target_dir = os.path.join(outdir, kind)
    os.makedirs(target_dir, exist_ok=True)
    path = os.path.join(target_dir, "{}.json".format(parse_date(date_str)))
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(tmp, path)
    return path


def meta_path(name, outdir=DATA_DIR):
    return os.path.join(outdir, "meta", name)


def load_themes(outdir=DATA_DIR):
    payload = read_json(meta_path("themes.json", outdir=outdir))
    if not isinstance(payload, dict):
        return {"canonical": {}, "event": [], "ignore": [], "reasons": {},
                "sentiment": {}}
    return {
        "canonical": payload.get("canonical") if isinstance(payload.get("canonical"), dict) else {},
        "event": payload.get("event") if isinstance(payload.get("event"), list) else [],
        "ignore": payload.get("ignore") if isinstance(payload.get("ignore"), list) else [],
        "reasons": payload.get("reasons") if isinstance(payload.get("reasons"), dict) else {},
        "sentiment": payload.get("sentiment") if isinstance(payload.get("sentiment"), dict) else {},
    }