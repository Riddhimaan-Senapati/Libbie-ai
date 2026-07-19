"""Tests for the live email connector + the .eml thread-root fix.

No network is touched: Gmail/IMAP wire calls are not exercised here -- instead we
test the pure, reusable pieces (thread-root reconstruction, header parsing, the
Gmail payload parser) and the offline ``.eml`` threading fix end to end.
"""

from __future__ import annotations

from email.message import EmailMessage

from libbie_engine import email_ingest as em
from libbie_engine.ingest import ingest_conversations
from libbie_engine.ingest.conversation import (
    immediate_parent,
    normalize_message_id,
    parse_references,
    resolve_thread_roots,
)
from libbie_engine.models import Message


# --------------------------------------------------------------------------- #
# Pure header helpers
# --------------------------------------------------------------------------- #
def test_normalize_and_parse_headers():
    assert normalize_message_id("  <a@host>  ") == "<a@host>"
    assert normalize_message_id("<a@h> extra") == "<a@h>"
    assert normalize_message_id("") is None
    assert parse_references("<a@h> <b@h>\n <c@h>") == ["<a@h>", "<b@h>", "<c@h>"]
    # In-Reply-To wins; else the LAST (most recent) References id.
    assert immediate_parent("<b@h>", "<a@h> <b@h>") == "<b@h>"
    assert immediate_parent(None, "<a@h> <b@h>") == "<b@h>"
    assert immediate_parent(None, None) is None


# --------------------------------------------------------------------------- #
# resolve_thread_roots -- the core clustering function
# --------------------------------------------------------------------------- #
def test_resolve_thread_roots_chain_collapses_to_root():
    # A <- B <- C : all three must resolve to A.
    parents = {"<A>": None, "<B>": "<A>", "<C>": "<B>"}
    roots = resolve_thread_roots(parents)
    assert roots == {"<A>": "<A>", "<B>": "<A>", "<C>": "<A>"}


def test_resolve_thread_roots_external_ancestor_is_root():
    # Root <A> is outside the batch; B and C still cluster under <A>.
    parents = {"<B>": "<A>", "<C>": "<B>"}
    roots = resolve_thread_roots(parents)
    assert roots == {"<B>": "<A>", "<C>": "<A>"}


def test_resolve_thread_roots_is_cycle_safe():
    parents = {"<X>": "<Y>", "<Y>": "<X>"}  # malformed loop
    roots = resolve_thread_roots(parents)  # must terminate, not hang
    assert set(roots) == {"<X>", "<Y>"}


# --------------------------------------------------------------------------- #
# Gmail payload parsing (pure) + thread root
# --------------------------------------------------------------------------- #
def _gmail_msg(mid_hdr, in_reply_to, references, subject, body, gid):
    import base64

    def hdr(name, value):
        return {"name": name, "value": value}

    headers = [hdr("From", "Elena <evasquez@lab.edu>"), hdr("Subject", subject),
               hdr("Date", "Mon, 13 Feb 2023 10:00:00 +0000"),
               hdr("Message-ID", mid_hdr)]
    if in_reply_to:
        headers.append(hdr("In-Reply-To", in_reply_to))
    if references:
        headers.append(hdr("References", references))
    data = base64.urlsafe_b64encode(body.encode()).decode()
    return {"id": gid, "payload": {"mimeType": "text/plain", "headers": headers, "body": {"data": data}}}


def test_gmail_parse_and_thread_root():
    msgs = [
        _gmail_msg("<A@g>", None, None, "Ref genome", "we go with GRCh37", "g1"),
        _gmail_msg("<B@g>", "<A@g>", "<A@g>", "Re: Ref genome", "agreed", "g2"),
        _gmail_msg("<C@g>", "<B@g>", "<A@g> <B@g>", "Re: Ref genome", "shipping it", "g3"),
    ]
    parsed = [em._parsed_from_gmail(m) for m in msgs]
    nodes = em._nodes_from_parsed(parsed, source="gmail")
    messages = [n for n in nodes if isinstance(n, Message)]
    assert len(messages) == 3
    # The whole reply chain collapses to ONE thread id (namespaced by source).
    tids = {m.thread_id for m in messages}
    assert len(tids) == 1 and next(iter(tids)) is not None
    assert messages[0].author == "evasquez@lab.edu"
    assert "GRCh37" in messages[0].text


# --------------------------------------------------------------------------- #
# IMAP-shaped parsing via a shared EmailMessage builder (no socket)
# --------------------------------------------------------------------------- #
def test_email_message_parsing_and_root():
    def build(mid, irt, refs, subject, body):
        m = EmailMessage()
        m["From"] = "Sam Roy <sam@lab.edu>"
        m["Subject"] = subject
        m["Date"] = "Mon, 13 Feb 2023 11:00:00 +0000"
        m["Message-ID"] = mid
        if irt:
            m["In-Reply-To"] = irt
        if refs:
            m["References"] = refs
        m.set_content(body)
        return m

    parsed = [
        em._parsed_from_email_message(build("<A@h>", None, None, "Plan", "start"), source="imap", path="imap://a"),
        em._parsed_from_email_message(build("<B@h>", "<A@h>", "<A@h>", "Re: Plan", "next"), source="imap", path="imap://b"),
    ]
    nodes = em._nodes_from_parsed(parsed, source="imap")
    messages = [n for n in nodes if isinstance(n, Message)]
    tids = {m.thread_id for m in messages}
    assert len(tids) == 1 and next(iter(tids)) is not None


# --------------------------------------------------------------------------- #
# conversation.py .eml threading FIX: a 3-message chain -> one thread_id
# --------------------------------------------------------------------------- #
def _write_eml(path, mid, irt, refs, subject, body):
    m = EmailMessage()
    m["From"] = "Elena <evasquez@lab.edu>"
    m["To"] = "sam@lab.edu"
    m["Subject"] = subject
    m["Date"] = "Mon, 13 Feb 2023 10:00:00 +0000"
    m["Message-ID"] = mid
    if irt:
        m["In-Reply-To"] = irt
    if refs:
        m["References"] = refs
    m.set_content(body)
    path.write_bytes(m.as_bytes())


def test_eml_reply_chain_collapses_to_one_thread(tmp_path):
    conv = tmp_path / "conversations"
    conv.mkdir()
    _write_eml(conv / "1.eml", "<root@lab>", None, None, "Reference genome", "we go with GRCh37")
    _write_eml(conv / "2.eml", "<reply1@lab>", "<root@lab>", "<root@lab>", "Re: Reference genome", "agreed, GRCh37")
    _write_eml(conv / "3.eml", "<reply2@lab>", "<reply1@lab>", "<root@lab> <reply1@lab>", "Re: Reference genome", "shipping it")

    nodes = ingest_conversations(str(conv))
    messages = [n for n in nodes if isinstance(n, Message)]
    assert len(messages) == 3
    # BEFORE the fix each message kept its own Message-ID as thread_id (3 threads);
    # after the fix all three share the ROOT id.
    thread_ids = {m.thread_id for m in messages}
    assert thread_ids == {"<root@lab>"}, thread_ids


def test_single_eml_no_threading_headers_stays_ungrouped(tmp_path):
    conv = tmp_path / "conversations"
    conv.mkdir()
    # A message with NO Message-ID / In-Reply-To / References at all.
    m = EmailMessage()
    m["From"] = "x@y.z"
    m["Subject"] = "lonely"
    m.set_content("no headers here")
    (conv / "lonely.eml").write_bytes(m.as_bytes())

    nodes = ingest_conversations(str(conv))
    messages = [n for n in nodes if isinstance(n, Message)]
    assert len(messages) == 1
    assert messages[0].thread_id is None  # single-file behavior preserved
