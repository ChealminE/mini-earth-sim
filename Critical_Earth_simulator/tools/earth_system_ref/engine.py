"""
지구 시스템 엔진 참조 구현 (Python 프로토타입) - js/earth-system.js 이식 시 대조 기준
4박스 탄소순환(대기·표층 해수·심층 해수·토양식생) + 2층 에너지 균형 기온 모델.
해수 화학식은 js/earth-model.js와 동일.

데이터 출처
- 배출량: Our World in Data, CO2 and Greenhouse Gas Emissions dataset
  (원자료: Global Carbon Project), CC BY 4.0
  https://github.com/owid/co2-data  -> data/historical_emissions_gtc.csv (MtCO2 -> GtC 변환)
  1750~1849 토지이용 배출은 원자료에 없어 선형으로 추정 (luc_estimated=1)
- 검증용 CO2: NOAA GML 마우나로아 연평균 (datasets/co2-ppm 경유) -> data/mlo_annual.csv

실행: python engine.py  (경로는 이 파일 위치 기준 ../../data/)
"""
import math, csv
import numpy as np

# ---------- 기존 earth-model.js 화학식 그대로 ----------
TA = 2.3e-3; S = 35; CA = 0.0103
def consts(tC):
    T = tC + 273.15
    K0 = math.exp(-60.2409 + 93.4517*(100/T) + 23.3585*math.log(T/100) + S*(0.023517 - 0.023656*(T/100) + 0.0047036*(T/100)**2))
    pK1 = 3633.86/T - 61.2172 + 9.67770*math.log(T) - 0.011555*S + 0.0001152*S*S
    pK2 = 471.78/T + 25.9290 - 3.16967*math.log(T) - 0.01781*S + 0.0001122*S*S
    logKsp = (-171.945 - 0.077993*T + 2903.293/T + 71.595*math.log10(T)
              + (-0.068393 + 0.0017276*T + 88.135/T)*math.sqrt(S) - 0.10018*S + 0.0059415*S**1.5)
    return K0, 10**-pK1, 10**-pK2, 10**logKsp

def state_from_pco2(ppm, tC):
    K0, K1, K2, Ksp = consts(tC)
    C = K0*ppm*1e-6*K1
    h = (C + math.sqrt(C*C + 8*TA*C*K2))/(2*TA)
    co2aq = K0*ppm*1e-6; hco3 = C/h; co3 = C*K2/h/h
    return dict(pH=-math.log10(h), dic=co2aq+hco3+co3, co3=co3, omega=CA*co3/Ksp)

def pco2_from_dic(dic, tC):
    # 새로 필요한 역함수: TA h^2 + (TA-DIC)K1 h + (TA-2DIC)K1K2 = 0
    K0, K1, K2, Ksp = consts(tC)
    a = TA; b = (TA-dic)*K1; c = (TA-2*dic)*K1*K2
    h = (-b + math.sqrt(b*b - 4*a*c))/(2*a)
    co2aq = dic*h*h/(h*h + K1*h + K1*K2)
    co3 = dic*K1*K2/(h*h + K1*h + K1*K2)
    return co2aq/K0*1e6, -math.log10(h), CA*co3/Ksp

def revelle(ppm, tC):
    d = 1.0
    a = state_from_pco2(ppm, tC)['dic']; b = state_from_pco2(ppm+d, tC)['dic']
    return (d/ppm)/((b-a)/a)

# ---------- 데이터 ----------
import os
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data')
em = {int(r['year']): [float(r['fossil_gtc']), float(r['luc_gtc'])]
      for r in csv.DictReader(open(os.path.join(DATA, 'historical_emissions_gtc.csv')))}
mlo = {int(r['Year']): float(r['Mean']) for r in csv.DictReader(open(os.path.join(DATA, 'mlo_annual.csv')))}

# ---------- 엔진 ----------
PPM2GTC = 2.124
MOL2GTC = 12e-15
A_OCEAN = 3.61e14; RHO = 1025
# 보정값: 앱이 2023년을 지구 평균 418.24 ppm으로 보여 주므로 마우나로아가 아니라
# 지구 평균(js/tab-current.js의 histCo2)에 맞춰 격자 탐색으로 고른 값이다.
# (예전 MLO 기준값: tau_mix=5.0, beta=0.32, c0=277.0)
P = dict(h_mix=100.0, h_deep=2000.0, k_gas=0.25, tau_mix=6.0,    # 해양
         npp0=60.0, tau_land=50.0, beta=0.38, q10=2.0,             # 토양·식생
         lam=1.2, Cs=8.0, Cd=100.0, gamma=0.7,                     # 2층 기온 (W, yr, m2, K)
         sst0=18.0, c0=278.0)

# 지구 평균 CO2 1988~2023 - js/tab-current.js의 histCo2를 그대로 옮긴 것 (검증용)
GLOBAL_CO2_START = 1988
GLOBAL_CO2 = [350.06,352.12,353.48,354.85,355.76,356.46,357.61,359.28,361.20,362.49,364.33,367.01,368.42,369.80,371.61,373.99,376.21,377.97,380.23,382.05,384.10,385.83,387.62,389.82,391.67,394.14,396.49,398.55,401.48,404.31,406.50,408.89,411.39,413.65,416.02,418.24]

# dt는 0.25년으로 고정한다. 결과가 dt에 따라 조금씩 달라지므로(전진 오일러)
# 보정값과 js/earth-system.js 대조가 모두 이 dt를 전제로 한다.
DT = 0.25

def run(years, emis_fn, p=P, dt=DT):
    Ms = A_OCEAN*p['h_mix']*RHO; Md = A_OCEAN*p['h_deep']*RHO
    ca = p['c0']*PPM2GTC
    dic_s = state_from_pco2(p['c0'], p['sst0'])['dic']; dic_d0 = dic_s; dic_d = dic_s
    cl0 = p['npp0']*p['tau_land']; cl = cl0
    T = 0.0; Td = 0.0
    out = []
    for y in years:
        E_f, E_l = emis_fn(y)
        fo = fl = 0
        for _ in range(int(round(1/dt))):
            ppm = ca/PPM2GTC
            pco2s, ph, om = pco2_from_dic(dic_s, p['sst0'] + T)
            F_ao = p['k_gas']*(ppm - pco2s)                          # GtC/yr 대기->표층
            F_sd = (dic_s - dic_d)*Ms/p['tau_mix']*MOL2GTC
            npp = p['npp0']*(1 + p['beta']*math.log(ppm/p['c0']))
            resp = cl/p['tau_land']*p['q10']**(T/10)
            F_land = npp - resp                                        # 대기->토양
            ca += (E_f + E_l - F_ao - F_land)*dt
            cl += (F_land - E_l)*dt
            dic_s += (F_ao - F_sd)/MOL2GTC/Ms*dt
            dic_d += F_sd/MOL2GTC/Md*dt
            F = 5.35*math.log(ppm/p['c0'])
            T += (F - p['lam']*T - p['gamma']*(T-Td))/p['Cs']*dt
            Td += p['gamma']*(T-Td)/p['Cd']*dt
            fo += F_ao*dt; fl += F_land*dt
        ppm = ca/PPM2GTC
        pco2s, ph, om = pco2_from_dic(dic_s, p['sst0'] + T)
        out.append(dict(y=y, ppm=ppm, T=T, ph=ph, om=om, ocean=fo, land=fl, E=E_f+E_l,
                        sst=p['sst0']+T, rev=revelle(ppm, p['sst0']+T)))
    return out

hist = lambda y: (em[y][0], em[y][1]) if y in em else (0, 0)
nature = lambda y: (0, 0)

def dump(path, runs):
    # js/earth-system.js 대조용 (tools/test_earth_system.js가 읽는다)
    import json
    keys = ['y', 'ppm', 'T', 'ph', 'om', 'ocean', 'land', 'E', 'sst', 'rev']
    data = dict(params=P, dt=DT, runs={k: {kk: [o[kk] for o in r] for kk in keys} for k, r in runs.items()})
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f)

def dump_runs():
    years = range(1750, 2201)
    return {'hist': run(years, hist), 'nature': run(years, nature)}

if __name__ == '__main__':
    import sys
    if len(sys.argv) >= 3 and sys.argv[1] == '--dump':
        # 사용: python engine.py --dump out.json
        dump(sys.argv[2], dump_runs())
        print('dumped ->', sys.argv[2])
        sys.exit(0)
    print('Revelle(280,18)=%.2f  (418,18)=%.2f  (800,18)=%.2f' % (revelle(280,18), revelle(418,18), revelle(800,18)))
    r = run(range(1750, 2024), hist)
    R = {o['y']: o for o in r}
    for y in [1850, 1900, 1950, 1980, 2000, 2010, 2020, 2023]:
        o = R[y]; ref = mlo.get(y, '-')
        print(f"{y} ppm {o['ppm']:.1f} (obs {ref})  T {o['T']:.2f}  pH {o['ph']:.3f}  Ω {o['om']:.2f}")
    dec = [R[y] for y in range(2014, 2024)]
    E = np.mean([o['E'] for o in dec]); O = np.mean([o['ocean'] for o in dec]); L = np.mean([o['land'] for o in dec])
    print(f"2014-23 avg: emis {E:.2f} ocean {O:.2f} land {L:.2f} atm {E-O-L:.2f} GtC/yr, airborne {(E-O-L)/E:.2f}")
    rmse = math.sqrt(np.mean([(R[y]['ppm']-mlo[y])**2 for y in range(1959, 2024)]))
    print('RMSE vs Mauna Loa 1959-2023: %.2f ppm' % rmse)
    rmse_g = math.sqrt(np.mean([(R[GLOBAL_CO2_START+i]['ppm']-v)**2 for i, v in enumerate(GLOBAL_CO2)]))
    print('RMSE vs global mean 1988-2023: %.2f ppm' % rmse_g)
