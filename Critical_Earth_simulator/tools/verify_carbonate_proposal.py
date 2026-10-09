# -*- coding: utf-8 -*-
"""10.09변경사항정리.md 의 제안식을 그대로 구현해 문서의 주장을 검증한다."""
import math, re, io, sys

# ── 현재 구현 (earth-model.js) ──
TA, K0, K1, K2 = 2.3e-3, 0.0283, 1.42e-6, 1.08e-9
CA, KSP_NOW = 0.0103, 6.65e-7

def ph_now(ppm):
    C = K0 * K1 * max(1, ppm) * 1e-6
    h = (C + math.sqrt(C*C + 8*TA*C*K2)) / (2*TA)
    return -math.log10(h)

def omega_now(ppm):
    C = K0 * K1 * max(1, ppm) * 1e-6
    h = (C + math.sqrt(C*C + 8*TA*C*K2)) / (2*TA)
    co3 = C * K2 / (h*h)
    return CA * co3 / KSP_NOW

# ── 제안식 (문서 3.2절 그대로) ──
S_DEF = 35.0
def consts(tC, S=S_DEF):
    T = tC + 273.15
    K0_ = math.exp(-60.2409 + 93.4517*(100/T) + 23.3585*math.log(T/100)
                   + S*(0.023517 - 0.023656*(T/100) + 0.0047036*(T/100)**2))
    pK1 = 3633.86/T - 61.2172 + 9.67770*math.log(T) - 0.011555*S + 0.0001152*S*S
    pK2 = 471.78/T + 25.9290 - 3.16967*math.log(T) - 0.01781*S + 0.0001122*S*S
    logKsp = (-171.945 - 0.077993*T + 2903.293/T + 71.595*math.log10(T)
              + (-0.068393 + 0.0017276*T + 88.135/T)*math.sqrt(S)
              - 0.10018*S + 0.0059415*S**1.5)
    return K0_, 10**-pK1, 10**-pK2, 10**logKsp

def state(ppm, tC=25.0, TA_=TA):
    k0, k1, k2, ksp = consts(tC)
    pCO2 = max(1, ppm) * 1e-6
    co2aq = k0 * pCO2
    C = co2aq * k1
    h = (C + math.sqrt(C*C + 8*TA_*C*k2)) / (2*TA_)
    hco3 = C / h
    co3 = C * k2 / (h*h)
    return dict(pH=-math.log10(h), co2aq=co2aq, hco3=hco3, co3=co3,
                dic=co2aq+hco3+co3, omega=CA*co3/ksp)

print("■ 체크 1: seawaterPH(ppm,25) vs 기존식 차이 (문서 주장: 0.002 이하 / 최대 0.0018)")
dmax, where = 0, 0
for ppm in range(280, 1001):
    d = abs(state(ppm, 25)['pH'] - ph_now(ppm))
    if d > dmax: dmax, where = d, ppm
print(f"   최대 차이 {dmax:.5f} @ {where}ppm  ->  {'통과' if dmax <= 0.002 else '실패'}")

print("\n■ 체크 2: HOT 관측 35점 RMSE (기존 0.007 유지되는가)")
src = io.open('Critical_Earth_simulator/js/tab-current.js', encoding='utf-8').read()
co2 = [float(x) for x in re.search(r'histCo2\s*=\s*\[(.*?)\]', src, re.S).group(1).split(',')]
phs = [None if x.strip() == 'null' else float(x)
       for x in re.search(r'histPh\s*=\s*\[(.*?)\]', src, re.S).group(1).split(',')]
pairs = [(c, p) for c, p in zip(co2, phs) if p is not None]
def rmse(f):
    return math.sqrt(sum((f(c)-p)**2 for c, p in pairs)/len(pairs))
r_now = rmse(ph_now)
print(f"   관측점 {len(pairs)}개")
print(f"   기존식          RMSE {r_now:.4f}")
for t in (25, 24, 20, 18):
    print(f"   제안식 {t:2d}°C     RMSE {rmse(lambda c, t=t: state(c, t)['pH']):.4f}")

print("\n■ 체크 3: 문서 3.3절 검증표 재현")
doc = {2:  {280:(8.183,2.07), 418:(8.025,1.49), 600:(7.879,1.09), 1000:(7.668,0.69)},
       18: {280:(8.190,3.65), 418:(8.042,2.76), 600:(7.904,2.10), 1000:(7.702,1.38)},
       25: {280:(8.184,4.54), 418:(8.042,3.51), 600:(7.908,2.72), 1000:(7.710,1.82)}}
bad = 0
for t in (2, 18, 25):
    row = []
    for ppm in (280, 418, 600, 1000):
        st = state(ppm, t)
        dp, do = doc[t][ppm]
        okp, oko = abs(st['pH']-dp) <= 0.001, abs(st['omega']-do) <= 0.015
        bad += (not okp) + (not oko)
        row.append(f"{st['pH']:.3f}{'' if okp else '!'}/{st['omega']:.2f}{'' if oko else '!'}")
    print(f"   {t:2d}°C  " + "  ".join(row))
print(f"   -> {'표 전부 재현됨' if bad == 0 else f'{bad}개 불일치(!)'}")

print("\n■ 체크 4: 문서의 부수 주장들")
print(f"   Ksp 25°C: 현재 {KSP_NOW:.3e} / Mucci {consts(25)[3]:.3e}  (문서 주장 6.48e-7)")
print(f"   Ω(418,25): 현재 {omega_now(418):.2f} -> 제안 {state(418,25)['omega']:.2f}  (문서 주장 3.43 -> 3.51)")
for t in (2, 25):
    print(f"   용존CO2(418, {t:2d}°C) = {state(418,t)['co2aq']*1e6:.1f} umol/kg   "
          f"DIC = {state(418,t)['dic']*1e6:.0f}  (문서: {'24.3/2225' if t==2 else '11.9/2091'})")
print("   수온별 pH 차이(418ppm, 2 vs 25°C) = "
      f"{abs(state(418,2)['pH']-state(418,25)['pH']):.4f}  (문서 주장: 0.02 정도로 작음)")

print("\n■ 체크 5: Ω<1 되는 CO2 (문서: 0°C 605 / 2°C 665 / 5°C 770 ppm)")
for t in (0, 2, 5):
    lo, hi = 280, 5000
    for _ in range(60):
        mid = (lo+hi)/2
        if state(mid, t)['omega'] > 1: lo = mid
        else: hi = mid
    print(f"   {t}°C -> {lo:.0f} ppm")

print("\n■ 체크 6: 현재 슬라이더 범위(<=1000ppm)에서 Ω<1 경고가 켜지는가")
for t, label in ((2, '빙하 냉수대'), (18, '전지구 평균'), (25, '아열대')):
    om = state(1000, t)['omega']
    print(f"   {label:10s} 1000ppm -> Ω {om:.2f} {'(경고 켜짐)' if om < 1 else '(안 켜짐)'}")
print(f"   현재 구현(온도 무시)      1000ppm -> Ω {omega_now(1000):.2f} "
      f"{'(경고 켜짐)' if omega_now(1000) < 1 else '(안 켜짐)'}")
