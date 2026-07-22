"use client";

import React, { useState } from 'react';

export default function MiniEarthSim() {
  // 1. 변인 통제를 위한 State(상태) 정의
  const [co2, setCo2] = useState(420); // 기본 CO2 농도 (ppm)
  const [fossilFuel, setFossilFuel] = useState(50); // 화석연료 사용량 (%)

  // 2. 변인에 따른 계산 로직 (간단한 수식 모델링)
  const estimatedTemp = (25 + (co2 - 420) * 0.05 + (fossilFuel - 50) * 0.1).toFixed(1);
  const seaLevel = (10 + (fossilFuel * 0.2)).toFixed(1);

  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', maxWidth: '1200px', margin: '0 auto' }}>
      <header>
        <h1 style={{ borderBottom: '2px solid #ddd', paddingBottom: '10px' }}>🌍 미니지구 시뮬레이션 대시보드</h1>
      </header>

      {/* 대시보드 메인 영역 */}
      <div style={{ display: 'flex', gap: '40px', marginTop: '20px' }}>
        
        {/* 좌측: 미니지구 시각화 공간 */}
        <div style={{ flex: 1, border: '1px solid #ccc', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
          <h3>미니지구 모형 (시각화 예정)</h3>
          <div style={{ fontSize: '40px', margin: '20px 0' }}>🏙️ 🌱 🌊</div>
          <p>상자 내부가 통제되고 있습니다.</p>
        </div>

        {/* 우측: 실시간 데이터 예측 그래프/수치 */}
        <div style={{ flex: 1, border: '1px solid #ccc', padding: '20px', borderRadius: '8px' }}>
          <h3>30년 후 예측 데이터 그래프</h3>
          <div style={{ margin: '15px 0', padding: '10px', background: '#f5f5f5', borderRadius: '4px' }}>
            <strong>🌡️ 예상 지구 기온:</strong> {estimatedTemp} °C
          </div>
          <div style={{ margin: '15px 0', padding: '10px', background: '#f5f5f5', borderRadius: '4px' }}>
            <strong>🌊 예상 해수면 높이:</strong> {seaLevel} m
          </div>
        </div>

      </div>

      {/* 하단: 파라미터 조작 슬라이더 */}
      <footer style={{ marginTop: '40px', padding: '20px', background: '#fafafa', borderRadius: '8px' }}>
        <h3>🎛️ 파라미터 슬라이더 (변인 제어)</h3>
        
        <div style={{ margin: '20px 0' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>🚗 자동차 화석연료 사용량: {fossilFuel}%</label>
          <input 
            type="range" min="0" max="100" value={fossilFuel} 
            onChange={(e) => setFossilFuel(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ margin: '20px 0' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>🏭 대기 CO2 농도: {co2} ppm</label>
          <input 
            type="range" min="300" max="1000" value={co2} 
            onChange={(e) => setCo2(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      </footer>
    </div>
  );
}