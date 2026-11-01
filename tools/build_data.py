#!/usr/bin/env python3
"""data/source/ の CSV から data/game.json と data/report.json を作り直します。

使い方:  python3 tools/build_data.py
外部への接続はしません。標準ライブラリだけを使います。
"""
import csv
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'source')
OUT = os.path.join(ROOT, 'data')

PARTS = ['head', 'chest', 'arms', 'waist', 'legs']
ELEMS = {'火': 'fire', '水': 'water', '雷': 'thunder', '氷': 'ice', '龍': 'dragon'}
ELEM_EN = {'Fire': 'fire', 'Water': 'water', 'Thunder': 'thunder', 'Ice': 'ice', 'Dragon': 'dragon',
           'Poison': 'poison', 'Sleep': 'sleep', 'Paralysis': 'paralysis', 'Blast': 'blast'}
MELEE = {'great-sword', 'long-sword', 'sword-and-shield', 'dual-blades', 'hammer', 'hunting-horn',
         'lance', 'gunlance', 'switch-axe', 'charge-blade', 'insect-glaive'}

report = {'commit': open(os.path.join(SRC, 'COMMIT')).read().strip(), 'rows': {}, 'missing_ref': [],
          'missing_ja': [], 'notes': []}


def read(rel):
    with open(os.path.join(SRC, rel), encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    report['rows'][rel] = len(rows)
    return rows


def ja_map(rel, kind):
    rows = read(rel)
    m = {}
    for r in rows:
        key = (r['name_en'], r.get('weapon_type')) if kind == 'weapon' else r['name_en']
        if r.get('name_ja'):
            m[key] = r['name_ja']
    return m


def need_ja(m, key, kind):
    v = m.get(key)
    if not v:
        report['missing_ja'].append({'kind': kind, 'name_en': key if isinstance(key, str) else key[0]})
        return None
    return v


def norm(s):
    s = unicodedata.normalize('NFKC', s or '')
    return re.sub(r'\s+', '', s)


def parse_effect(desc_ja):
    """スキルのレベルごとの説明文から、計算に使える数値を読み取ります。"""
    d = norm(desc_ja)
    e = {}
    m = re.search(r'基礎攻撃力\+(\d+)', d)
    if m:
        e['atk'] = int(m.group(1))
    m = re.search(r'(?<!属性)攻撃力(\d+(?:\.\d+)?)倍', d)
    if m:
        e['atkMul'] = float(m.group(1))
    m = re.search(r'会心率\+(\d+)%', d)
    if m:
        e['aff'] = int(m.group(1))
    m = re.search(r'会心攻撃時のダメージ倍率を(\d+(?:\.\d+)?)倍', d)
    if m:
        e['critMul'] = float(m.group(1))
    for k, v in ELEMS.items():
        m = re.search(k + r'属性攻撃値を(\d+(?:\.\d+)?)倍', d)
        if m:
            e.setdefault('elemMul', {})[v] = float(m.group(1))
        m = re.search(k + r'属性攻撃値に?\+(\d+)', d)
        if m:
            e.setdefault('elemAdd', {})[v] = int(m.group(1))
        m = re.search(k + r'耐性\+(\d+)', d)
        if m:
            e.setdefault('res', {})[v] = int(m.group(1))
    m = re.search(r'(?<![火水雷氷龍])属性値に\+(\d+)', d)
    if m:
        e['elemAddAll'] = int(m.group(1))
    m = re.search(r'防御力を(\d+(?:\.\d+)?)倍', d)
    if m:
        e['defMul'] = float(m.group(1))
    m = re.search(r'防御力\+(\d+)', d)
    if m:
        e['def'] = int(m.group(1))
    m = re.search(r'全属性耐性値\+(\d+)', d)
    if m:
        e['resAll'] = int(m.group(1))
    m = re.search(r'体力\+(\d+)', d)
    if m:
        e['health'] = int(m.group(1))
    m = re.search(r'ダメージを(\d+)%軽減', d)
    if m:
        e['dmgCut'] = int(m.group(1))
    if not e:
        return None
    if '回毎' in d:
        e['cond'] = 'faint'
    elif '武器出し' in d:
        e['cond'] = 'draw'
    elif '有効部位' in d:
        e['cond'] = 'weak'
    elif '発動中' in d or '発動時' in d or '維持している間' in d:
        e['cond'] = 'active'
    return e


def main():
    # ---- skills
    sk_base = read('skills/skill_base.csv')
    sk_tr = {r['name_en']: r for r in read('skills/skill_base_translations.csv')}
    sk_lv = read('skills/skill_levels.csv')
    levels = defaultdict(list)
    for r in sk_lv:
        levels[r['base_name_en']].append(r)
    skills = []
    sid = {}
    for i, r in enumerate(sk_base):
        sid[r['name_en']] = i
    for i, r in enumerate(sk_base):
        en = r['name_en']
        tr = sk_tr.get(en)
        ja = tr['name_ja'] if tr and tr.get('name_ja') else None
        if not ja:
            report['missing_ja'].append({'kind': 'skill', 'name_en': en})
        lv = sorted(levels.get(en, []), key=lambda x: int(x['level']))
        if not lv:
            report['missing_ref'].append({'kind': 'skill_levels', 'name_en': en, 'detail': 'レベルの行がない'})
        secret = int(r['secret']) if r['secret'] else 0
        unlocks = None
        if r['unlocks']:
            if r['unlocks'] in sid:
                unlocks = sid[r['unlocks']]
            else:
                report['missing_ref'].append({'kind': 'skill.unlocks', 'name_en': en, 'detail': r['unlocks']})
        skills.append({
            'id': i, 'en': en, 'ja': ja or en,
            'desc': (tr or {}).get('description_ja', ''),
            'maxAll': len(lv), 'max': len(lv) - secret, 'secret': secret, 'unlocks': unlocks,
            'levels': [{'lv': int(x['level']), 'ja': x['description_ja'], 'en': x['description_en'],
                        'eff': parse_effect(x['description_ja'])} for x in lv],
        })
    for s in skills:
        if s['unlocks'] is not None:
            skills[s['unlocks']]['unlockedBy'] = s['id']

    def skill_ref(name, kind, owner):
        if not name:
            return None
        if name in sid:
            return sid[name]
        report['missing_ref'].append({'kind': kind, 'name_en': owner, 'detail': name})
        return None

    # ---- set bonuses
    bon_ja = ja_map('armors/armorset_bonus_base_translations.csv', 'bonus')
    bonuses = []
    bid = {}
    for r in read('armors/armorset_bonus_base.csv'):
        b = {'id': len(bonuses), 'en': r['name_en'], 'ja': need_ja(bon_ja, r['name_en'], 'set_bonus') or r['name_en'],
             'skills': []}
        for k in ('1', '2'):
            s = skill_ref(r['skill%s_name' % k], 'set_bonus.skill', r['name_en'])
            if s is not None:
                b['skills'].append([s, int(r['skill%s_required' % k])])
        bid[r['name_en']] = b['id']
        bonuses.append(b)

    # ---- armor sets
    set_ja = ja_map('armors/armorset_base_translations.csv', 'set')
    sets = []
    piece_set = {}
    for r in read('armors/armorset_base.csv'):
        bonus = None
        if r['bonus']:
            bonus = bid.get(r['bonus'])
            if bonus is None:
                report['missing_ref'].append({'kind': 'armorset.bonus', 'name_en': r['name_en'], 'detail': r['bonus']})
        s = {'id': len(sets), 'en': r['name_en'], 'ja': need_ja(set_ja, r['name_en'], 'armor_set') or r['name_en'],
             'rank': r['rank'], 'bonus': bonus}
        sets.append(s)
        for p in PARTS:
            if r[p]:
                if r[p] in piece_set:
                    report['notes'].append('防具 %s が複数のシリーズに入っています' % r[p])
                piece_set[r[p]] = s['id']

    # ---- armor
    ar_ja = ja_map('armors/armor_base_translations.csv', 'armor')
    ar_sk = {}
    for r in read('armors/armor_skills_ext.csv'):
        lst = []
        for k in ('1', '2'):
            s = skill_ref(r['skill%s_name' % k], 'armor.skill', r['base_name_en'])
            if s is not None:
                lst.append([s, int(r['skill%s_level' % k])])
        ar_sk[r['base_name_en']] = lst
    armors = []
    for r in read('armors/armor_base.csv'):
        en = r['name_en']
        st = piece_set.get(en)
        if st is None:
            report['missing_ref'].append({'kind': 'armor.set', 'name_en': en, 'detail': 'シリーズに入っていない'})
        if en not in ar_sk:
            report['missing_ref'].append({'kind': 'armor.skills', 'name_en': en, 'detail': 'スキルの行がない'})
        ja = need_ja(ar_ja, en, 'armor')
        slots = sorted([int(r['slot_%d' % k]) for k in (1, 2, 3) if int(r['slot_%d' % k]) > 0], reverse=True)
        armors.append({
            'id': int(r['id']), 'en': en, 'ja': ja or en, 'jaMissing': ja is None, 'part': r['type'],
            'rarity': int(r['rarity']), 'gender': r['gender'],
            'rank': sets[st]['rank'] if st is not None else None, 'set': st,
            'slots': slots,
            'def': [int(r['defense_base']), int(r['defense_max']), int(r['defense_augment_max'])],
            'res': [int(r['defense_' + e]) for e in ('fire', 'water', 'thunder', 'ice', 'dragon')],
            'skills': ar_sk.get(en, []),
        })

    # ---- decorations
    de_ja = ja_map('decorations/decoration_base_translations.csv', 'decoration')
    decos = []
    for r in read('decorations/decoration_base.csv'):
        lst = []
        for k in ('1', '2'):
            s = skill_ref(r['skill%s_name' % k], 'decoration.skill', r['name_en'])
            if s is not None:
                lst.append([s, int(r['skill%s_level' % k])])
        ja = need_ja(de_ja, r['name_en'], 'decoration')
        decos.append({'id': int(r['id']), 'en': r['name_en'], 'ja': ja or r['name_en'], 'jaMissing': ja is None,
                      'size': int(r['slot']), 'rarity': int(r['rarity']), 'skills': lst})

    # ---- charms
    ch_ja = ja_map('charms/charm_base_translations.csv', 'charm')
    rows = read('charms/charm_base.csv')
    names = {r['name_en'] for r in rows}
    has_next = {r['previous_en'] for r in rows if r['previous_en']}
    charms = []
    cid = {}
    for r in rows:
        lst = []
        for k in ('1', '2'):
            s = skill_ref(r['skill%s_name' % k], 'charm.skill', r['name_en'])
            if s is not None:
                lst.append([s, int(r['skill%s_level' % k])])
        if r['previous_en'] and r['previous_en'] not in names:
            report['missing_ref'].append({'kind': 'charm.previous', 'name_en': r['name_en'], 'detail': r['previous_en']})
        ja = need_ja(ch_ja, r['name_en'], 'charm')
        c = {'id': int(r['id']), 'en': r['name_en'], 'ja': ja or r['name_en'], 'jaMissing': ja is None,
             'rarity': int(r['rarity']), 'skills': lst, 'prev': r['previous_en'] or None,
             'final': r['name_en'] not in has_next}
        cid[r['name_en']] = c
        charms.append(c)
    for c in charms:
        c['prev'] = cid[c['prev']]['id'] if c['prev'] in cid else None

    # ---- weapons
    we_ja = ja_map('weapons/weapon_base_translations.csv', 'weapon')
    weapons = []
    for r in read('weapons/weapon_base.csv'):
        key = (r['name_en'], r['weapon_type'])
        ja = need_ja(we_ja, key, 'weapon')
        wsk = []
        wbonus = None
        if r['skill']:
            if r['skill'] in bid:
                # 武器の「skill」列にシリーズスキル名が入っている武器は、その部位数に 1 つ数えます。
                wbonus = bid[r['skill']]
            else:
                s = skill_ref(r['skill'], 'weapon.skill', r['name_en'])
                if s is not None:
                    wsk.append([s, 1])
        el = []
        for k in ('1', '2'):
            if r['element%s' % k]:
                el.append([ELEM_EN.get(r['element%s' % k], r['element%s' % k].lower()), int(r['element%s_attack' % k] or 0)])
        weapons.append({
            'id': int(r['id']), 'en': r['name_en'], 'ja': ja or r['name_en'], 'jaMissing': ja is None,
            'type': r['weapon_type'], 'rarity': int(r['rarity']), 'attack': int(r['attack']),
            'affinity': int(r['affinity'] or 0), 'defense': int(r['defense'] or 0),
            'elemHidden': r['element_hidden'] == 'TRUE', 'elements': el,
            'slots': sorted([int(r['slot_%d' % k]) for k in (1, 2, 3) if int(r['slot_%d' % k] or 0) > 0], reverse=True),
            'skills': wsk, 'bonus': wbonus, 'final': True,
        })
    prev = {r['previous_en'] for r in read('weapons/weapon_base.csv') if r['previous_en']}
    for w in weapons:
        w['final'] = w['en'] not in prev

    game = {'commit': report['commit'], 'skills': skills, 'bonuses': bonuses, 'sets': sets, 'armors': armors,
            'decos': decos, 'charms': charms, 'weapons': weapons}
    with open(os.path.join(OUT, 'game.json'), 'w', encoding='utf-8') as f:
        json.dump(game, f, ensure_ascii=False, separators=(',', ':'))
    report['counts'] = {'armors': len(armors), 'sets': len(sets), 'bonuses': len(bonuses), 'decos': len(decos),
                        'charms': len(charms), 'charms_final': sum(c['final'] for c in charms),
                        'skills': len(skills), 'skill_levels': len(sk_lv), 'weapons': len(weapons)}
    report['parsed_skills'] = sorted(s['en'] for s in skills if any(l['eff'] for l in s['levels']))
    with open(os.path.join(OUT, 'report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report['counts'], ensure_ascii=False))
    print('missing_ref', len(report['missing_ref']), 'missing_ja', len(report['missing_ja']))


if __name__ == '__main__':
    sys.exit(main())
