# 프리셋 시나리오 정의 (js/earth-system.js의 PRESETS가 이것과 같아야 한다)
import engine as E, math, numpy as np
p=dict(E.P); p.update(c0=278.0,tau_mix=6.0,h_deep=2000.0,beta=0.38,tau_land=50.0,k_gas=0.25)
e23=E.em[2023][0]+E.em[2023][1]
def mk(kind):
    def f(y):
        if kind=='nature': return (0,0)
        if y<=2023: return E.hist(y)
        if kind=='bau': return (E.em[2023][0]*(1+0.01*(y-2023)) if y<2100 else E.em[2023][0]*1.77, E.em[2023][1]*max(0,1-(y-2023)/80))
        end={'nz2050':2050,'paris':2075}[kind]
        k=max(0,1-(y-2023)/(end-2023)); return (E.em[2023][0]*k, E.em[2023][1]*k)
    return f
if __name__=='__main__':
    r=E.run(range(1750,2024),E.hist,p,dt=0.25); R={o['y']:o for o in r}
    print('hist RMSE', round(math.sqrt(np.mean([(R[y]['ppm']-E.mlo[y])**2 for y in range(1959,2024)])),2))
    for y in [1850,1900,1950,2000,2023]: print(y, round(R[y]['ppm'],1), round(R[y]['T'],2), round(R[y]['ph'],3))
    dec=[R[y] for y in range(2014,2024)]
    print('sinks ocean %.2f land %.2f'%(np.mean([o['ocean'] for o in dec]),np.mean([o['land'] for o in dec])))
    for k in ['nature','bau','paris','nz2050']:
        r=E.run(range(1750,2201),mk(k),p,dt=0.25); R={o['y']:o for o in r}
        print(f'--- {k}')
        for y in [2023,2050,2100,2150,2200]:
            o=R[y]; print(f"  {y}: {o['ppm']:.0f}ppm T{o['T']:+.2f} SST{o['sst']:.1f} pH{o['ph']:.3f} Ω{o['om']:.2f} Rev{o['rev']:.1f}")
