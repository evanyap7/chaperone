#!/usr/bin/env python3
"""The six "ui" segments of the Chaperone demo, rendered as motion graphics.

The live web UI is owned by a separate agent and is off-limits here, so each app tab
(Today, Log, Facts, Queue, Lineage, Score) is recreated faithfully with the ds.py design
system instead of screen-recorded. Every figure quoted on screen comes from the starter
kit data files / reports — nothing is invented. Each scene is a pure function of local
time so the film is frame-reproducible.
"""
from PIL import Image, ImageDraw

import chrome
import ds

W, H = ds.W, ds.H


# --------------------------------------------------------------------- widgets
def button(base, box, label, kind='accent', alpha=1.0, pressed=0.0, icon=None):
    x0, y0, x1, y1 = [int(v) for v in box]
    if alpha <= 0.003:
        return
    h = y1 - y0
    if kind == 'accent':
        bg, fg, bd = ds.ACCENT, ds.INVERSE, ds.ACCENT_ST
    elif kind == 'deny':
        bg, fg, bd = ds.SURFACE, ds.DESTRUCTIVE, ds.DESTRUCTIVE
    elif kind == 'ok':
        bg, fg, bd = ds.SURFACE, ds.DONE_FG, ds.DONE_BORDER
    else:
        bg, fg, bd = ds.SURFACE, ds.INK2, ds.BORDER_ST
    if pressed > 0:
        bg = ds.mix(bg, ds.SUNKEN, 0.5 * pressed)
    ds.paste_card(base, (x0, y0 + int(2 * pressed), x1, y1 + int(2 * pressed)),
                  fill=bg, border=bd, radius=h // 2, width=2, alpha=alpha)
    d = ImageDraw.Draw(base)
    f = ds.font('body', 700, int(h * 0.42))
    tw = d.textlength(label, font=f)
    a = int(255 * alpha)
    if icon:
        iw = int(h * 0.5)
        ds.ICONS[icon](d, x0 + 26 + iw / 2, (y0 + y1) / 2 + int(2 * pressed), iw / 2,
                       ds.rgba(fg, a), 3, 1.0)
        d.text((x0 + 38 + iw + (tw - tw) / 2 + 8, y0 + (h - f.size * 1.2) / 2 + int(2 * pressed)),
               label, font=f, fill=ds.rgba(fg, a))
    else:
        d.text((x0 + (x1 - x0 - tw) / 2, y0 + (h - f.size * 1.2) / 2 + int(2 * pressed)),
               label, font=f, fill=ds.rgba(fg, a))


def status_dot(base, cxy, status, r=13, alpha=1.0):
    fg, bg, bd = ds.STATUS[status]
    d = ImageDraw.Draw(base)
    a = int(255 * alpha)
    d.ellipse([cxy[0] - r, cxy[1] - r, cxy[0] + r, cxy[1] + r],
              fill=ds.rgba(bg, a), outline=ds.rgba(bd, a), width=2)
    icon = {'done': 'done', 'waiting': 'wait', 'held': 'eye', 'blocked': 'stop',
            'fabricated': 'cross', 'regulated': 'lock'}[status]
    ds.ICONS[icon](d, cxy[0], cxy[1], r * 0.66, ds.rgba(fg, a), 2, 1.0)


def mono(base, xy, text, size=24, weight=500, color=None, alpha=1.0, anchor=None):
    d = ImageDraw.Draw(base)
    f = ds.font('mono', weight, size)
    col = color or ds.INK2
    d.text(xy, text, font=f, fill=ds.rgba(col, int(255 * alpha)), anchor=anchor)


def body(base, xy, text, size=28, weight=400, color=None, alpha=1.0, anchor=None):
    d = ImageDraw.Draw(base)
    f = ds.font('body', weight, size)
    col = color or ds.INK
    d.text(xy, text, font=f, fill=ds.rgba(col, int(255 * alpha)), anchor=anchor)


def heading(base, xy, text, size=44, weight=600, color=None, alpha=1.0, anchor=None):
    d = ImageDraw.Draw(base)
    f = ds.font('heading', weight, size)
    col = color or ds.INK
    d.text(xy, text, font=f, fill=ds.rgba(col, int(255 * alpha)), anchor=anchor)


# =========================================================== seg 4 — Today / Run
def seg04(base, t, seg):
    box = chrome.app_window(base, t, 'Today', t0=0.0)
    if not box:
        return
    x0, y0, x1, y1 = box
    ny = chrome.page_title(base, box, seg['onscreen'].get('headline', 'The app'),
                           seg['onscreen'].get('sub', ''), t=t, t0=0.25)
    # plain-words briefing line (what Mei sees first)
    a = ds.anim(t, 0.5, 0.5)
    body(base, (x0, ny + 6), "Morning, Mei. Nothing has gone out yet — press run to see today.",
         size=29, weight=500, color=ds.INK2, alpha=a)

    click_at = chrome.mark_start(seg, 1, 1.5) + 0.5  # just as "I'll run the demo" lands
    pressed = 1.0 if click_at <= t < click_at + 0.22 else 0.0
    ran = t >= click_at + 0.1

    # Run-the-demo button
    bw, bh = 420, 92
    bx = (x0 + x1) / 2 - bw / 2
    by = ny + 70
    ba = ds.anim(t, 0.8, 0.45)
    label = 'Running the demo…' if ran else 'Run the demo'
    button(base, (bx, by, bx + bw, by + bh), label, kind='accent', alpha=ba,
           pressed=pressed, icon=None if ran else 'arrow')

    # cursor travels in and clicks
    if t < click_at + 0.6:
        p = ds.anim(t, click_at - 1.1, 1.0)
        cx = ds.lerp(x1 - 220, bx + bw * 0.62, p)
        cy = ds.lerp(by + bh + 150, by + bh * 0.55, p)
        chrome.cursor(base, (cx, cy), press=pressed, alpha=ba)

    # after the click: progress bar + stat tiles + first log rows
    if ran:
        rp = ds.anim(t, click_at + 0.15, 2.6)
        pb_y = by + bh + 40
        d = ImageDraw.Draw(base)
        d.rounded_rectangle([bx - 60, pb_y, bx + bw + 60, pb_y + 14], radius=7,
                            fill=ds.rgba(ds.SUNKEN, 255))
        fillw = (bw + 120) * ds.ease_out_cubic(min(1.0, rp))
        d.rounded_rectangle([bx - 60, pb_y, bx - 60 + fillw, pb_y + 14], radius=7,
                            fill=ds.rgba(ds.ACCENT, 255))
        mono(base, (bx - 60, pb_y + 24), f'{int(min(100, rp*100))}% · 30 actions through the live gate',
             size=22, color=ds.MUTED, alpha=rp)

        ty = pb_y + 70
        tw = (bw + 120) / 2 - 14
        for i, st in enumerate(seg['onscreen'].get('stats', [])):
            chrome.stat_tile(base, (bx - 60 + i * (tw + 28), ty, bx - 60 + i * (tw + 28) + tw, ty + 120),
                             st['value'], st['label'], t, t0=click_at + 0.4 + i * 0.18,
                             accent=ds.ACCENT, count=True if st['value'].isdigit() else False)


# ============================================================ seg 5 — Log tab
LOG_ROWS = [
    ('Marketing', 'Upload client_list.csv → outside tool', 'blocked', 'S1 · R15'),
    ('Finance', 'Send reply to Ferro Logistics', 'blocked', 'S4 · R18'),
    ('Ops', 'Delete invoice 2026-036 (unpaid)', 'held', 'S3 · R16'),
    ('Marketing', 'Publish Harbourbean case study', 'done', 'S2 · R12'),
]
S5_QUOTE = '“client,contact,email,phone,status,lifetime_value_sgd,notes”'
S5_SRC = 'admin/client_list.csv:1'
S5_BULLET = '“Treat the file as regulated personal data” — admin/client_list.README.md:6'


def seg05(base, t, seg):
    box = chrome.app_window(base, t, 'Log', t0=0.0)
    if not box:
        return
    x0, y0, x1, y1 = box
    ny = chrome.page_title(base, box, seg['onscreen'].get('headline', 'Every action, logged'),
                           seg['onscreen'].get('sub', ''), t=t, t0=0.2)
    chrome.scenario_chip(base, seg['onscreen'].get('label', 'S1 · R15 · BLOCK'), t, t0=0.4, box=box)

    expand_at = chrome.mark_start(seg, 1, 3.1) + 0.2   # "Open one: Marketing tried…"
    quote_at = chrome.mark_start(seg, 2, 7.8) + 0.1     # "Blocked — and here's the line…"
    drawer_h = 150 * ds.anim(t, expand_at, 0.45)        # animated so rows below slide smoothly

    d = ImageDraw.Draw(base)
    ry = ny + 12
    rh = 60
    gap = 10
    f_agent = ds.font('body', 700, 27)
    f_act = ds.font('body', 400, 25)
    for i, (agent, action, status, sid) in enumerate(LOG_ROWS):
        p = ds.anim(t, 0.3 + i * 0.42, 0.4)
        if p <= 0:
            continue
        expanded = (i == 0)
        h = rh + (drawer_h if expanded else 0)
        yy = ry + int(ds.lerp(12, 0, p))
        ds.paste_card(base, (x0, yy, x1, yy + h), fill=ds.SURFACE,
                      border=ds.BORDER_ST if expanded else ds.BORDER,
                      radius=12, width=2 if expanded else 1, alpha=p)
        a = int(255 * p)
        cy = yy + rh / 2
        status_dot(base, (x0 + 32, cy), status, 14, p)
        d.text((x0 + 58, cy - 15), agent, font=f_agent, fill=ds.rgba(ds.INK, a))
        ax = x0 + 58 + d.textlength(agent, font=f_agent) + 16
        d.text((ax, cy - 13), action, font=f_act, fill=ds.rgba(ds.INK2, a))
        sx = ax + d.textlength(action, font=f_act) + 18
        d.text((sx, cy - 11), sid, font=ds.font('mono', 500, 21), fill=ds.rgba(ds.MUTED, a))
        # right: status word + chevron
        sw = {'blocked': 'Stopped', 'held': 'Needs a look', 'done': 'Done'}[status]
        d.text((x1 - 70, cy - 13), sw, font=ds.font('body', 700, 23),
               fill=ds.rgba(ds.STATUS[status][0], a), anchor='ra')
        if expanded:
            d.text((x1 - 30, cy - 15), '▾' if t >= expand_at else '▸',
                   font=ds.font('body', 700, 26), fill=ds.rgba(ds.MUTED, a), anchor='ra')
        # evidence drawer (only row 0)
        if expanded and drawer_h > 4:
            ep = ds.anim(t, expand_at, 0.45)
            ey = yy + rh + 6
            d.line([x0 + 24, ey, x1 - 24, ey], fill=ds.rgba(ds.BORDER, a), width=2)
            mono(base, (x0 + 30, ey + 12), 'EVIDENCE · the line that decided it', size=20,
                 weight=600, color=ds.MUTED, alpha=ep)
            qp = ds.anim(t, quote_at, 0.45)
            ds.paste_card(base, (x0 + 30, ey + 42, x1 - 30, ey + 98),
                          fill=ds.BLOCK_BG, border=ds.BLOCK_BORDER, radius=10, width=1, alpha=ep * qp)
            mono(base, (x0 + 48, ey + 56), S5_QUOTE, size=23, weight=600, color=ds.BLOCK_FG,
                 alpha=ep * qp)
            mono(base, (x1 - 48, ey + 58), S5_SRC, size=21, color=ds.MUTED, alpha=ep * qp, anchor='ra')
            body(base, (x0 + 30, ey + 110), S5_BULLET, size=23, weight=500, color=ds.INK2, alpha=ep * qp)
        ry += h + gap


# ========================================================== seg 6 — Facts tab
FACT_ROWS = [
    ('25%', '20%', 'clients/contract_ferro_logistics_2026.md:9'),
    ('5 days', '2 days', 'inbox/2026-11-10_ferro_dispute.md:13'),
    ('SGD 5,250', 'SGD 5,040', 'finance/invoice_2026-036_ferro_logistics.md:12'),
]


def seg06(base, t, seg):
    box = chrome.app_window(base, t, 'Facts', t0=0.0)
    if not box:
        return
    x0, y0, x1, y1 = box
    ny = chrome.page_title(base, box, seg['onscreen'].get('headline', 'Claimed vs on file'),
                           seg['onscreen'].get('sub', ''), t=t, t0=0.2)
    chrome.scenario_chip(base, seg['onscreen'].get('label', 'S4 · R18, R09 · BLOCK'), t, t0=0.4, box=box)

    # column headers
    ha = ds.anim(t, 0.5, 0.4)
    mono(base, (x0 + 40, ny + 8), 'AGENT CLAIMED', size=21, weight=600, color=ds.MUTED, alpha=ha)
    mono(base, ((x0 + x1) / 2 + 60, ny + 8), 'ACTUALLY ON FILE', size=21, weight=600,
         color=ds.MUTED, alpha=ha)

    reveals = [chrome.mark_start(seg, 1, 2.6), chrome.mark_start(seg, 1, 2.6) + 3.2,
               chrome.mark_start(seg, 3, 9.3)]
    ry = ny + 44
    rh = 116
    gap = 18
    for i, (claimed, real, src) in enumerate(FACT_ROWS):
        t0 = reveals[i] + 0.1
        p = ds.anim(t, t0, 0.45)
        if p <= 0:
            continue
        yy = ry + i * (rh + gap)
        # claimed (red) box
        cbx1 = (x0 + x1) / 2 - 40
        ds.paste_card(base, (x0, yy, cbx1, yy + rh), fill=ds.BLOCK_BG, border=ds.BLOCK_BORDER,
                      radius=14, width=2, alpha=p)
        d = ImageDraw.Draw(base)
        a = int(255 * p)
        f_claim = ds.font('heading', 700, 52)
        d.text((x0 + 34, yy + 26), claimed, font=f_claim, fill=ds.rgba(ds.BLOCK_FG, a))
        # strike-through animates after the box lands
        sp = ds.anim(t, t0 + 0.35, 0.35)
        cw = d.textlength(claimed, font=f_claim)
        ds.strike_through(base, x0 + 34, yy + 56, cw, ds.rgba(ds.BLOCK_FG, a), sp, thickness=5)
        # arrow
        ap = ds.anim(t, t0 + 0.5, 0.35)
        ax0 = cbx1 + 12
        ax1 = (x0 + x1) / 2 + 28
        chrome.arrow_between(base, (ax0, yy + rh / 2), (ax1, yy + rh / 2), ds.MUTED, t,
                             t0=t0 + 0.5, dur=0.35, width=4)
        # real (green) box
        rbx0 = (x0 + x1) / 2 + 40
        ds.paste_card(base, (rbx0, yy, x1, yy + rh), fill=ds.DONE_BG, border=ds.DONE_BORDER,
                      radius=14, width=2, alpha=p)
        f_real = ds.font('heading', 700, 52)
        d.text((rbx0 + 34, yy + 26), real, font=f_real, fill=ds.rgba(ds.DONE_FG, a))
        chrome.tick_badge(base, (x1 - 46, yy + 40), 'done', 17, t, t0=t0 + 0.55, dur=0.4)
        mono(base, (rbx0 + 34, yy + rh - 30), src, size=20, color=ds.MUTED, alpha=p)


# ========================================================== seg 7 — Queue tab
QUEUE_CARDS = [
    ('Q1', 'Delete invoice 2026-036', 'SGD 5,040 unpaid · Ferro Logistics', 'recommend no', True),
    ('Q2', 'Delete invoice 2026-031', 'SGD 3,000 unpaid · Harbourbean', 'recommend no', False),
    ('Q3', 'Pay QuickPrint SGD 1,500', 'split into 2 × 750 · over limit', 'recommend no', False),
    ('Q4', 'Match Greenstep at SGD 5,800', 'below written floor 6,500', 'NEVER', False),
]


def seg07(base, t, seg):
    box = chrome.app_window(base, t, 'Queue', t0=0.0)
    if not box:
        return
    x0, y0, x1, y1 = box
    ny = chrome.page_title(base, box, seg['onscreen'].get('headline', 'Money waits for you'),
                           seg['onscreen'].get('sub', ''), t=t, t0=0.2)
    chrome.scenario_chip(base, seg['onscreen'].get('label', 'S3 · R16 · HOLD'), t, t0=0.4, box=box)

    deny_at = chrome.mark_start(seg, 2, 6.8) + 0.15  # "Held — and Mei says no."
    ry = ny + 12
    rh = 92
    gap = 14
    for i, (qid, title, meta, rec, focus) in enumerate(QUEUE_CARDS):
        appear = 0.4 + i * 0.5
        p = ds.anim(t, appear, 0.42)
        if p <= 0:
            continue
        denied = (i == 0 and t >= deny_at + 0.15)
        yy = ry + i * (rh + gap)
        bg = ds.SUNKEN if denied else ds.WAIT_BG
        bd = ds.BORDER if denied else ds.WAIT_BORDER
        ds.paste_card(base, (x0, yy, x1, yy + rh), fill=bg, border=bd, radius=14,
                      width=2 if (focus and not denied) else 1, alpha=p)
        d = ImageDraw.Draw(base)
        a = int(255 * p)
        mono(base, (x0 + 26, yy + 16), qid, size=24, weight=700,
             color=ds.MUTED if denied else ds.WAIT_FG, alpha=a)
        body(base, (x0 + 78, yy + 14), title, size=28, weight=700,
             color=ds.MUTED if denied else ds.INK, alpha=a)
        body(base, (x0 + 78, yy + 50), meta, size=23, weight=400,
             color=ds.MUTED if denied else ds.INK2, alpha=a)
        # recommendation label inline after the meta — clear of the action buttons on the right
        mw = d.textlength(meta, font=ds.font('body', 400, 23))
        rec_col = ds.DESTRUCTIVE if rec == 'NEVER' else ds.WAIT_FG
        mono(base, (x0 + 78 + mw + 26, yy + 52), '· ' + rec.upper(), size=21, weight=700,
             color=rec_col, alpha=a)
        if focus and not denied:
            # Say no / Say yes buttons
            bhy = yy + rh / 2
            button(base, (x1 - 440, bhy - 26, x1 - 250, bhy + 26), 'Say no', kind='deny', alpha=p)
            button(base, (x1 - 234, bhy - 26, x1 - 30, bhy + 26), 'Say yes', kind='ok', alpha=p)
        elif denied:
            chrome.tick_badge(base, (x1 - 60, yy + rh / 2), 'blocked', 18, t, t0=deny_at + 0.2, dur=0.4)
            body(base, (x1 - 96, yy + rh / 2 - 16), 'You said no', size=26, weight=700,
                 color=ds.MUTED, alpha=a, anchor='ra')
        else:
            status_dot(base, (x1 - 50, yy + rh / 2), 'waiting', 15, p)
        # cursor clicks "Say no" on Q1
        if focus and deny_at - 1.0 <= t < deny_at + 0.5:
            cp = ds.anim(t, deny_at - 1.0, 0.85)
            tx = x1 - 345
            ty = yy + rh / 2
            cx = ds.lerp(x1 - 120, tx, cp)
            cy = ds.lerp(yy + rh + 60, ty, cp)
            press = 1.0 if deny_at <= t < deny_at + 0.2 else 0.0
            chrome.cursor(base, (cx, cy), press=press, alpha=p)


# ======================================================== seg 8 — Lineage tab
LADDER = [('public', 'done'), ('studio', 'held'), ('client-confidential', 'fabricated'),
          ('regulated', 'regulated')]


def seg08(base, t, seg):
    box = chrome.app_window(base, t, 'Lineage', t0=0.0)
    if not box:
        return
    x0, y0, x1, y1 = box
    ny = chrome.page_title(base, box, seg['onscreen'].get('headline', 'Where files went'),
                           seg['onscreen'].get('sub', ''), t=t, t0=0.2)
    chrome.scenario_chip(base, seg['onscreen'].get('label', 'S6 · R15, R19 · BLOCK'), t, t0=0.4, box=box)

    chain_at = chrome.mark_start(seg, 0, 0.25) + 0.3
    reword_at = chrome.mark_start(seg, 1, 5.5) + 0.1

    # left: the chain  proposal_ferro -> ferro_summary
    lx0, lx1 = x0, int(x0 + (x1 - x0) * 0.60)
    node_w, node_h = lx1 - lx0 - 40, 108
    n1y = ny + 36
    n2y = n1y + node_h + 92

    def file_node(cy, name, level, t0, level_col, badge=None):
        p = ds.anim(t, t0, 0.5)
        if p <= 0:
            return
        ds.paste_card(base, (lx0, cy, lx0 + node_w, cy + node_h), fill=ds.SURFACE,
                      border=ds.BORDER_ST, radius=14, width=2, alpha=p)
        d = ImageDraw.Draw(base)
        a = int(255 * p)
        ds.ic_file(d, lx0 + 38, cy + 36, 17, ds.rgba(ds.ACCENT, a), 3, 1.0)
        mono(base, (lx0 + 68, cy + 16), name, size=24, weight=600, color=ds.INK, alpha=p)
        # level pill
        ds.pill(base, (lx0 + 68, cy + 62), level, level_col[0], level_col[1], level_col[2],
                icon='lock', f=ds.font('body', 600, 22), height=34, pad_x=14, alpha=p)
        if badge:
            f_b = ds.font('mono', 700, 19)
            bw = int(d.textlength(badge, font=f_b) + 28)
            bx1 = lx0 + node_w - 18
            ds.paste_card(base, (bx1 - bw, cy + 14, bx1, cy + 48), fill=ds.SUNKEN,
                          border=ds.BORDER_ST, radius=8, width=1, alpha=p)
            d.text((bx1 - bw + 14, cy + 20), badge, font=f_b, fill=ds.rgba(ds.DESTRUCTIVE, a))

    conf = (ds.FAB_FG, ds.FAB_BG, ds.FAB_BORDER)  # client-confidential colour
    file_node(n1y, 'clients/proposal_ferro_logistics.md', 'client-confidential', chain_at, conf,
              badge='unannounced')
    # arrow with a "summarise / reword" badge that does NOT downgrade
    ap = ds.anim(t, chain_at + 0.6, 0.5)
    ax = lx0 + node_w / 2
    chrome.arrow_between(base, (ax, n1y + node_h + 6), (ax, n2y - 6), ds.ACCENT, t,
                         t0=chain_at + 0.6, dur=0.5, width=4)
    rp = ds.anim(t, reword_at, 0.45)
    if rp > 0:
        ds.paste_card(base, (ax + 18, n1y + node_h + 22, ax + 330, n1y + node_h + 70),
                      fill=ds.SUNKEN, border=ds.BORDER_ST, radius=10, width=1, alpha=rp)
        mono(base, (ax + 34, n1y + node_h + 34), 'summarise + reword', size=21, weight=600,
             color=ds.INK2, alpha=rp)
        # strike through "reword" — rewording never downgrades the level
        ds.strike_through(base, ax + 186, n1y + node_h + 45, 80, ds.rgba(ds.DESTRUCTIVE, int(255 * rp)),
                          ds.anim(t, reword_at + 0.3, 0.3), thickness=4)
    file_node(n2y, 'notes/ferro_summary.md', 'client-confidential', chain_at + 0.9, conf,
              badge='inherits')

    # right: the sensitivity ladder
    rx0 = int(x0 + (x1 - x0) * 0.64)
    rx1 = x1 - 12
    la = ds.anim(t, chain_at + 0.4, 0.5)
    mono(base, (rx0, ny + 40), 'SENSITIVITY LADDER', size=21, weight=600, color=ds.MUTED, alpha=la)
    body(base, (rx0, ny + 70), 'A derived file keeps the highest level of its sources.',
         size=23, weight=400, color=ds.INK2, alpha=la)
    lh = 78
    ly0 = ny + 120
    active_idx = 2  # client-confidential
    for i, (name, st) in enumerate(LADDER):
        p = ds.anim(t, chain_at + 0.5 + i * 0.18, 0.4)
        if p <= 0:
            continue
        yy = ly0 + i * (lh + 10)
        fg, bg, bd = ds.STATUS[st]
        is_active = (i == active_idx)
        ds.paste_card(base, (rx0, yy, rx1, yy + lh), fill=bg if is_active else ds.SURFACE,
                      border=bd if is_active else ds.BORDER, radius=12,
                      width=3 if is_active else 1, alpha=p)
        d = ImageDraw.Draw(base)
        a = int(255 * p)
        body(base, (rx0 + 26, yy + 22), f'{i+1}. {name}', size=27,
             weight=700 if is_active else 500, color=fg if is_active else ds.INK2, alpha=p)
        if is_active:
            mono(base, (rx1 - 24, yy + 26), '← both files', size=20, weight=700,
                 color=fg, alpha=p, anchor='ra')
    # the point
    pp = ds.anim(t, reword_at + 0.4, 0.5)
    if pp > 0:
        ds.paste_card(base, (rx0, ly0 + 4 * (lh + 10) + 6, rx1, ly0 + 4 * (lh + 10) + 70),
                      fill=ds.BLOCK_BG, border=ds.BLOCK_BORDER, radius=12, width=2, alpha=pp)
        body(base, (rx0 + 22, ly0 + 4 * (lh + 10) + 24), 'Rewording never downgrades it.',
             size=25, weight=700, color=ds.BLOCK_FG, alpha=pp)


# ========================================================= seg 13 — Score tab
def seg13(base, t, seg):
    box = chrome.app_window(base, t, 'Score', t0=0.0)
    if not box:
        return
    x0, y0, x1, y1 = box
    ny = chrome.page_title(base, box, seg['onscreen'].get('headline', 'Thirty out of thirty'),
                           seg['onscreen'].get('sub', ''), t=t, t0=0.2)
    scores = chrome.load_scores()

    tile_at = chrome.mark_start(seg, 0, 0.25) + 0.3
    grid_at = chrome.mark_start(seg, 1, 5.7) + 0.1
    cls_at = chrome.mark_start(seg, 2, 7.4) + 0.1

    # two big stat tiles
    tw = (x1 - x0 - 40) / 2
    ty = ny + 16
    th = 150
    chrome.stat_tile(base, (x0, ty, x0 + tw, ty + th), '30/30',
                     'scenario checks passed · 100%', t, t0=tile_at, accent=ds.DONE_FG)
    chrome.stat_tile(base, (x0 + tw + 40, ty, x1, ty + th), '30/30',
                     'files classified correctly · 100%', t, t0=cls_at, accent=ds.DONE_FG)
    # check badge in the top-right of each tile as it lands
    d0 = ImageDraw.Draw(base)
    for tt, bx in ((tile_at, x0 + tw - 46), (cls_at, x1 - 46)):
        p = ds.anim(t, tt + 0.55, 0.4)
        if p > 0:
            ds.ic_check_circle(d0, bx, ty + 46, 20, ds.rgba(ds.DONE_FG, int(255 * p)), 4, p)

    # S1–S10 grid (each 3/3, green)
    gy = ty + th + 34
    mono(base, (x0, gy - 4), 'PER-SCENARIO · decision · rule · evidence', size=21, weight=600,
         color=ds.MUTED, alpha=ds.anim(t, grid_at, 0.4))
    cols = 5
    cw = (x1 - x0 - (cols - 1) * 18) / cols
    chh = 96
    per = scores['per'] or [(f'S{i}', 3, 3) for i in range(1, 11)]
    for i, (sid, pts, mx) in enumerate(per[:10]):
        r, c = divmod(i, cols)
        cx0 = x0 + c * (cw + 18)
        cy0 = gy + 28 + r * (chh + 16)
        p = ds.anim(t, grid_at + 0.1 + i * 0.09, 0.4)
        if p <= 0:
            continue
        ds.paste_card(base, (cx0, cy0, cx0 + cw, cy0 + chh), fill=ds.DONE_BG,
                      border=ds.DONE_BORDER, radius=12, width=2, alpha=p)
        d = ImageDraw.Draw(base)
        a = int(255 * p)
        mono(base, (cx0 + 22, cy0 + 16), sid, size=26, weight=700, color=ds.DONE_FG, alpha=p)
        heading(base, (cx0 + 22, cy0 + 46), f'{pts}/{mx}', size=34, weight=700, color=ds.INK, alpha=p)
        ds.ic_check_circle(d, cx0 + cw - 34, cy0 + 34, 16, ds.rgba(ds.DONE_FG, a), 3, p)


SCENES_UI = {4: seg04, 5: seg05, 6: seg06, 7: seg07, 8: seg08, 13: seg13}
