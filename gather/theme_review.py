"""题材字典提案与确认工具。

用法：
    python theme_review.py propose   生成提案表 themes.proposal.json
    python theme_review.py apply     应用已确认的提案到 themes.json
    python theme_review.py status    查看当前字典规模与兜底占比

本脚本只依赖标准库，不导入 pandas / requests，
以便在采集环境受限时也能独立运行。
"""

import collections
import datetime
import glob
import io
import json
import os
import sys

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
THEME_OTHER = "其他概念"
PROPOSAL_NAME = "themes.proposal.json"
THEME_JSON = "themes.json"


def parse_date(value):
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    text = str(value or "").strip()
    for sep in ("-", "/", "."):
        text = text.replace(sep, "")
    if len(text) == 8 and text.isdigit():
        return "{}-{}-{}".format(text[:4], text[4:6], text[6:])
    return text


def read_json(path):
    if not os.path.exists(path):
        return None
    try:
        with io.open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


def meta_path(name, outdir=DATA_DIR):
    return os.path.join(outdir, "meta", name)


def load_themes(outdir=DATA_DIR):
    payload = read_json(meta_path(THEME_JSON, outdir=outdir))
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


def _iter_other_stocks(outdir=DATA_DIR):
    pattern = os.path.join(outdir, "limit_up", "*.json")
    for path in sorted(glob.glob(pattern)):
        payload = read_json(path) or {}
        for stock in payload.get("stocks") or []:
            if stock.get("theme") != THEME_OTHER:
                continue
            yield os.path.basename(path), stock


def _collect(outdir=DATA_DIR):
    hits = collections.Counter()
    reasons = collections.defaultdict(list)
    for _file, stock in _iter_other_stocks(outdir):
        for tag in stock.get("tags") or []:
            hits[tag] += 1
            if len(reasons[tag]) < 3:
                reasons[tag].append(stock.get("name") or "")
    return hits, reasons


def _guess_target(tag, themes):
    canonical = themes.get("canonical") or {}
    for name, aliases in canonical.items():
        for alias in aliases:
            if alias and alias in tag:
                return name, "append"
    for name, words in (themes.get("sentiment") or {}).items():
        for word in words:
            if word and word in tag:
                return name, "sentiment"
    for word in themes.get("event") or []:
        if word and word in tag:
            return word, "event"
    for word in themes.get("ignore") or []:
        if word and word in tag:
            return None, "ignore"
    return None, "new"


def build_proposal(outdir=DATA_DIR, min_count=3):
    themes = load_themes(outdir=outdir)
    hits, reasons = _collect(outdir)
    items = []
    for tag, count in hits.most_common():
        if count < min_count:
            continue
        target, action = _guess_target(tag, themes)
        items.append({
            "tag": tag,
            "count": count,
            "samples": reasons.get(tag) or [],
            "action": action,
            "target": target or "",
            "accept": None,
            "reason": "",
        })
    payload = {
        "generated_at": parse_date(datetime.date.today()),
        "total_tags": len(hits),
        "proposed": len(items),
        "min_count": min_count,
        "instructions": [
            "对每项的 accept 填 true 或 false；其余项保持 null 表示暂不处理",
            "accept=true 且 action=append：把 tag 追加到 target 题材的别名",
            "accept=true 且 action=new：以 tag 为名新建题材，可在 target 填归入的父题材名",
            "accept=true 且 action=sentiment：把 tag 追加到 target 情绪题材",
            "accept=true 且 action=event：把 tag 加入 event 列表",
            "accept=true 且 action=ignore：把 tag 加入 ignore 噪声词",
            "reason 可留空，填写后会写入 reasons 段作为该题材的驱动逻辑",
            "改完后执行 python theme_review.py apply",
        ],
        "items": items,
    }
    path = meta_path(PROPOSAL_NAME, outdir=outdir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(tmp, path)
    return path, payload


def _read_raw(path):
    with io.open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _write_raw(payload, path):
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(tmp, path)


def apply_proposal(outdir=DATA_DIR):
    proposal_path = meta_path(PROPOSAL_NAME, outdir=outdir)
    theme_path = meta_path(THEME_JSON, outdir=outdir)
    proposal = read_json(proposal_path)
    if not isinstance(proposal, dict):
        raise RuntimeError("提案表不存在，请先执行 propose")
    raw = _read_raw(theme_path)
    canonical = raw.setdefault("canonical", {})
    event = raw.setdefault("event", [])
    ignore = raw.setdefault("ignore", [])
    sentiment = raw.setdefault("sentiment", {})
    reasons = raw.setdefault("reasons", {})

    applied = {"append": 0, "new": 0, "sentiment": 0, "event": 0, "ignore": 0}
    skipped = []
    for item in proposal.get("items") or []:
        if item.get("accept") is not True:
            continue
        tag = str(item.get("tag") or "").strip()
        target = str(item.get("target") or "").strip()
        action = str(item.get("action") or "").strip()
        if not tag:
            skipped.append({"tag": "", "reason": "tag 为空"})
            continue
        if action == "append":
            name = target or THEME_OTHER
            aliases = canonical.setdefault(name, [])
            if not isinstance(aliases, list):
                aliases = [str(aliases)]
                canonical[name] = aliases
            if tag not in aliases:
                aliases.append(tag)
                applied["append"] += 1
            else:
                skipped.append({"tag": tag, "reason": "别名已存在"})
        elif action == "new":
            name = target or tag
            aliases = canonical.setdefault(name, [])
            if not isinstance(aliases, list):
                aliases = [str(aliases)]
                canonical[name] = aliases
            if name not in aliases:
                aliases.insert(0, name)
            if tag not in aliases:
                aliases.append(tag)
                applied["new"] += 1
            else:
                skipped.append({"tag": tag, "reason": "别名已存在"})
        elif action == "sentiment":
            name = target or tag
            words = sentiment.setdefault(name, [])
            if not isinstance(words, list):
                words = [str(words)]
                sentiment[name] = words
            if tag not in words:
                words.append(tag)
                applied["sentiment"] += 1
            else:
                skipped.append({"tag": tag, "reason": "关键词已存在"})
        elif action == "event":
            name = target or tag
            if name not in event:
                event.append(name)
                applied["event"] += 1
            else:
                skipped.append({"tag": tag, "reason": "event 已存在"})
        elif action == "ignore":
            if tag not in ignore:
                ignore.append(tag)
                applied["ignore"] += 1
            else:
                skipped.append({"tag": tag, "reason": "ignore 已存在"})
        else:
            skipped.append({"tag": tag, "reason": "action 无法识别: " + action})

        text = str(item.get("reason") or "").strip()
        name = str(item.get("target") or "").strip() or tag
        if text and name:
            reasons[name] = text

    raw["updated_at"] = parse_date(datetime.date.today())
    _write_raw(raw, theme_path)
    return {"applied": applied, "skipped": skipped}


def status(outdir=DATA_DIR):
    themes = load_themes(outdir=outdir)
    total = other = 0
    for _file, stock in _iter_other_stocks(outdir):
        total += 1
        other += 1
    pattern = os.path.join(outdir, "limit_up", "*.json")
    all_stocks = 0
    for path in sorted(glob.glob(pattern)):
        payload = read_json(path) or {}
        all_stocks += len(payload.get("stocks") or [])
    return {
        "themes": len(themes.get("canonical") or {}),
        "event": len(themes.get("event") or []),
        "sentiment": len(themes.get("sentiment") or {}),
        "ignore": len(themes.get("ignore") or []),
        "reasons": len(themes.get("reasons") or {}),
        "stocks": all_stocks,
        "other": total,
        "ratio": (total * 100.0 / all_stocks) if all_stocks else 0.0,
    }


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "propose"
    if cmd == "propose":
        min_count = int(argv[2]) if len(argv) > 2 else 3
        path, payload = build_proposal(min_count=min_count)
        print("提案表已生成: %s" % path)
        print("候选方向 %s 个（阈值 count>=%s，总标签 %s 个）"
              % (payload["proposed"], payload["min_count"], payload["total_tags"]))
        print("请对 accept 字段填 true/false 后执行: python theme_review.py apply")
    elif cmd == "apply":
        result = apply_proposal()
        print("已应用:", json.dumps(result["applied"], ensure_ascii=False))
        if result["skipped"]:
            print("跳过 %s 项:" % len(result["skipped"]))
            for node in result["skipped"]:
                print("  - %s %s" % (node["tag"], node["reason"]))
        print("请重跑采集后执行 status 查看覆盖率")
    elif cmd == "status":
        data = status()
        print("题材 %s | event %s | sentiment %s | ignore %s | reasons %s"
              % (data["themes"], data["event"], data["sentiment"],
                 data["ignore"], data["reasons"]))
        print("兜底 %s / %s = %.1f%%" % (data["other"], data["stocks"], data["ratio"]))
    else:
        print("用法: python theme_review.py [propose|apply|status]")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))