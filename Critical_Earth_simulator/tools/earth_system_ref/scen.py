# 프리셋 시나리오 정의 (js/earth-system.js의 PRESETS가 이것과 같아야 한다)
# 2차 개편: 근거 없이 만든 직선 경로(bau/paris/nz2050)를 IPCC SSP 배출 경로로 바꿨다.
# SSP 원값은 tools/gen_earth_data.py 가 RCMIP 원본에서 만든 data/ssp_emissions.csv (GtC/yr, 연 단위 보간)이고,
# JS는 같은 CSV에서 만든 js/earth-data.js 를 읽으므로 두 쪽의 입력이 같다.
# 조화: 2024년부터 SSP를 잇되, 2023년의 GCP 값과 SSP 값의 차이를 2050년까지 선형으로 줄여 0으로 만든다.
import engine as E, math, numpy as np
SSP_KEYS = ['ssp245', 'ssp126', 'ssp119']
HARMONIZE_END = 2050
LAST_HIST = 2023
ssp = {k: {} for k in SSP_KEYS}
for r in E.read_clean('ssp_emissions.csv'):
    for k in SSP_KEYS:
        ssp[k][int(r['year'])] = (float(r[k + '_fossil']), float(r[k + '_luc']))

def mk(kind):
    if kind == 'nature':
        return lambda y: (0, 0)
    s23 = ssp[kind][LAST_HIST]
    dF, dL = E.em[LAST_HIST][0] - s23[0], E.em[LAST_HIST][1] - s23[1]
    def f(y):
        if y <= LAST_HIST: return E.hist(y)
        w = max(0, 1 - (y - LAST_HIST) / (HARMONIZE_END - LAST_HIST))
        sf, sl = ssp[kind][y]
        return (sf + dF * w, sl + dL * w)
    return f

if __name__=='__main__':
    for k in SSP_KEYS:
        s23 = ssp[k][LAST_HIST]
        print('%s 2023 SSP fossil %.4f luc %.4f / GCP %.4f %.4f -> 조화 차이 %+.4f %+.4f GtC/yr' % (
            k, s23[0], s23[1], E.em[LAST_HIST][0], E.em[LAST_HIST][1], E.em[LAST_HIST][0]-s23[0], E.em[LAST_HIST][1]-s23[1]))
    for k in ['nature'] + SSP_KEYS:
        r=E.run(range(1750,2201),mk(k)); R={o['y']:o for o in r}
        print(f'--- {k}')
        for y in [2023,2050,2100,2150,2200]:
            o=R[y]; print(f"  {y}: E {o['E']:.2f} {o['ppm']:.0f}ppm T{o['T']:+.2f} SST{o['sst']:.1f} pH{o['ph']:.3f} Ω{o['om']:.2f} Rev{o['rev']:.1f}")
