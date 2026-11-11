#!/usr/bin/env python3
"""Build lib/ip-geo.bin.gz: which country, and in India which state, a
network address is in, for the panel's Analytics (owner, 11 Nov 2026: "see
if you can tell it was opened from which state").

From DB-IP's free IP to City Lite database (CC BY 4.0, attribution to
DB-IP.com, linked where the results are shown: the panel's Analytics), as
published on npm by ip-location-db:

    npm pack @ip-location-db/dbip-city && tar -xzf ip-location-db-dbip-city-*.tgz
    python3 scripts/build-ip-geo.py package/

Only the country, and the state for India, are kept: no city, no
coordinates. Neighbouring ranges in the same place are joined, and IPv6 is
kept to its first 64 bits (the network, never a device), so the file is a
few megabytes. Read by lib/ip-geo.js.

Layout (little-endian): b'PFAGEO1\\n', the source's version (uint32 length
+ utf-8), the place codes (uint32 length + utf-8, newline-joined; code 0 is
'' for an address no one has placed), then for IPv4 a uint32 count, the
range starts (uint32 each) and their codes (uint16 each), and the same for
IPv6 with uint64 starts."""
import csv, gzip, json, struct, sys, os

SRC = sys.argv[1] if len(sys.argv) > 1 else 'package/'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib', 'ip-geo.bin.gz')

# India's states and union territories as DB-IP names them, to the
# ISO 3166-2:IN codes lib/analytics.js shows (REGIONS)
STATES = {
    'Andaman and Nicobar': 'AN', 'Andaman and Nicobar Islands': 'AN', 'Andhra Pradesh': 'AP', 'Arunachal Pradesh': 'AR',
    'Assam': 'AS', 'Bihar': 'BR', 'Chandigarh': 'CH', 'Chhattisgarh': 'CT',
    'Dadra and Nagar Haveli and Daman and Diu': 'DH', 'Dadra and Nagar Haveli': 'DH', 'Daman and Diu': 'DH',
    'Delhi': 'DL', 'National Capital Territory of Delhi': 'DL', 'Goa': 'GA', 'Gujarat': 'GJ', 'Haryana': 'HR',
    'Himachal Pradesh': 'HP', 'Jammu and Kashmir': 'JK', 'Jharkhand': 'JH', 'Karnataka': 'KA', 'Kerala': 'KL',
    'Ladakh': 'LA', 'Lakshadweep': 'LD', 'Madhya Pradesh': 'MP', 'Maharashtra': 'MH', 'Manipur': 'MN',
    'Meghalaya': 'ML', 'Mizoram': 'MZ', 'Nagaland': 'NL', 'Odisha': 'OR', 'Puducherry': 'PY', 'Punjab': 'PB',
    'Rajasthan': 'RJ', 'Sikkim': 'SK', 'Tamil Nadu': 'TN', 'Telangana': 'TG', 'Tripura': 'TR',
    'Uttar Pradesh': 'UP', 'Uttarakhand': 'UT', 'West Bengal': 'WB'
}

codes = ['']
index = {'': 0}
unknown_states = {}


def code_of(country, state):
    if country == 'IN':
        st = STATES.get(state)
        if not st and state:
            unknown_states[state] = unknown_states.get(state, 0) + 1
        key = f'IN-{st}' if st else 'IN'
    else:
        key = country if len(country) == 2 else ''
    if key not in index:
        index[key] = len(codes)
        codes.append(key)
    return index[key]


def table(fn, shift):
    starts, cs = [], []
    last_end = -1
    with gzip.open(os.path.join(SRC, fn), 'rt', encoding='utf-8') as f:
        for r in csv.reader(f):
            s, e = int(r[0]) >> shift, int(r[1]) >> shift
            c = code_of(r[2], r[3])
            if s > last_end + 1:  # a gap no one has placed
                if not cs or cs[-1] != 0:
                    starts.append(last_end + 1); cs.append(0)
            if cs and cs[-1] == c and starts[-1] <= s:
                pass  # the same place carries on
            elif starts and starts[-1] == s:
                cs[-1] = c  # a finer range at the same /64: the later one
            else:
                starts.append(s); cs.append(c)
            last_end = max(last_end, e)
    return starts, cs


v4 = table('dbip-city-ipv4-num.csv.gz', 0)
v6 = table('dbip-city-ipv6-num.csv.gz', 64)
version = json.load(open(os.path.join(SRC, 'package.json')))['version']
buf = bytearray(b'PFAGEO1\n')
for text in (f'DB-IP IP to City Lite, ip-location-db {version}', '\n'.join(codes)):
    b = text.encode('utf-8')
    buf += struct.pack('<I', len(b)) + b
for (starts, cs), fmt in ((v4, 'I'), (v6, 'Q')):
    buf += struct.pack('<I', len(starts))
    buf += struct.pack(f'<{len(starts)}{fmt}', *starts)
    buf += struct.pack(f'<{len(cs)}H', *cs)
with gzip.open(OUT, 'wb', compresslevel=9) as f:
    f.write(bytes(buf))
print('ip-geo:', len(v4[0]), 'IPv4 ranges,', len(v6[0]), 'IPv6 networks,', len(codes), 'places,', os.path.getsize(OUT), 'bytes')
if unknown_states:
    print('India, state not mapped:', unknown_states)
