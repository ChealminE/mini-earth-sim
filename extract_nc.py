import xarray as xr
import pandas as pd
import warnings
import os

warnings.filterwarnings('ignore')

# 1. 처리할 5개의 .nc 파일 목록
nc_files = [
    'SSP_1850_2014.nc',
    'SSP1-2.6_2015_2100.nc',
    'SSP2-4.5_2015_2100.nc',
    'SSP3-7.0_2015_2100.nc',
    'SSP5-8.5_2015_2100.nc'
]

print("🌍 기후 모델 5종 개별 추출을 시작합니다...\n")

for file_path in nc_files:
    if not os.path.exists(file_path):
        print(f"❌ 오류: '{file_path}' 파일을 찾을 수 없습니다.")
        continue
        
    print(f"▶ [{file_path}] 분석 및 자르기 진행 중...")
    
    try:
        ds = xr.open_dataset(file_path)
        
        lat_col = 'lat' if 'lat' in ds.dims else 'latitude'
        lon_col = 'lon' if 'lon' in ds.dims else 'longitude'
        
        ds = ds.sortby(lat_col)
        ds = ds.sortby(lon_col)
        
        # 대한민국 격자 자르기
        korea_ds = ds.sel({
            lat_col: slice(33.0, 39.0),
            lon_col: slice(124.0, 131.0)
        })
        
        # 공간 평균 계산
        korea_spatial_mean = korea_ds.mean(dim=[lat_col, lon_col], keep_attrs=True)
        
        # 연도별 평균
        if 'time' in korea_spatial_mean.dims:
            yearly_data = korea_spatial_mean.groupby('time.year').mean(dim='time')
        else:
            yearly_data = korea_spatial_mean
            
        df = yearly_data.to_dataframe().reset_index()
        
        # --- (강력한 데이터 단위 변환 및 정리 시작) ---
        
        rename_dict = {}
        # 모든 열 이름을 소문자로 바꾸고 양옆 공백을 제거하여 철저하게 검사
        for col in df.columns:
            clean_col = str(col).strip().lower()
            
            # 1. 기온 변환 (ta 또는 tas)
            if clean_col in ['ta', 'tas']:
                # 값이 200보다 크면 켈빈(K)으로 간주하고 273.15를 빼서 섭씨로 변환
                if df[col].mean() > 200: 
                    df[col] = df[col] - 273.15
                rename_dict[col] = '평균기온(°C)'
            
            # 2. 강수량 변환 (pr)
            elif clean_col == 'pr':
                df[col] = df[col] * 86400
                rename_dict[col] = '강수량(mm/day)'
                
            # 3. CO2 농도 변환
            elif 'co2' in clean_col or 'carbon' in clean_col:
                if df[col].mean() < 1: 
                    df[col] = df[col] * 1e6
                rename_dict[col] = 'CO2농도(ppm)'

        # 이름 강제 적용
        df.rename(columns=rename_dict, inplace=True)

        # 4. 불필요한 메타데이터 열 확실하게 제거 (realization 포함)
        cols_to_drop = ['height', 'bnds', 'time_bnds', 'lat_bnds', 'lon_bnds', 'realization']
        # 현재 df에 존재하는 열만 소문자로 비교해서 삭제
        drop_list = [col for col in df.columns if str(col).strip().lower() in cols_to_drop]
        df = df.drop(columns=drop_list, errors='ignore')
        
        # --- (데이터 단위 변환 및 정리 끝) ---

        # 파일명에서 폴더 경로('SSP_data/')를 떼어내고 현재 폴더에 깔끔하게 저장
        output_name = file_path.split('/')[-1].replace('.nc', '_KOR.csv')
        df.to_csv(output_name, index=False, encoding='utf-8-sig')
        
        print(f"   ✅ 완료! '{output_name}' 생성됨.\n")
        ds.close()
        
    except Exception as e:
        print(f"   ❌ 변환 중 에러 발생: {e}\n")

print("🎉 모든 시나리오 파일 변환이 완료되었습니다!")