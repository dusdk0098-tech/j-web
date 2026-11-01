# 한글 PDF 회귀 시험 자료

`synthetic-korean.pdf`는 업무 자료와 관계없이 독립 생성한 7,026바이트 가상 PDF입니다. 본문은 `작업계획서`, `가상시험`이며 `/Stamp` 인쇄 주석의 정적 appearance에 빨간 `시험`을 넣었습니다. 실제 개인정보·서명·도장·사용자 파일은 포함하지 않습니다.

글꼴은 Google Fonts가 배포하는 Nanum Gothic Regular에서 필요한 9글자만 축소했습니다.
- 공식 원본: https://github.com/google/fonts/blob/main/ofl/nanumgothic/NanumGothic-Regular.ttf
- 원본 SHA-256: `76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31`
- 저작권: Copyright (c) 2010, NHN Corporation.
- 라이선스: SIL Open Font License 1.1, 전문은 이 폴더의 `OFL.txt`.
- 원본 라이선스: https://github.com/google/fonts/blob/main/ofl/nanumgothic/OFL.txt
- 예약 글꼴 이름을 사용하지 않도록 축소 글꼴의 이름은 `JWebKoreanFixture`로 변경했습니다. 글꼴 데이터는 PDF에만 포함하며 OFL로 재배포합니다.

재생성은 원본 TTF를 별도 경로에 받은 뒤 이 폴더에서 `uv run --with fonttools==4.60.1 generate.py 원본.ttf`로 실행합니다. 생성기가 원본 해시를 확인하며 다른 파일이면 거절합니다. Python/uv/FontTools와 네트워크는 재생성 시에만 필요하고 Node 시험 실행에는 필요하지 않습니다. PDF의 SHA-256은 `ec768ea41c7fc488994f50f2a1ad068e98c503f315174b8e9d2d2b1169a026fc`입니다.

`expected.png`는 PDF.js 6.4.299, @napi-rs/canvas 1.0.10에서 생성한 450×300 기준 이미지이며 한글 본문과 빨간 도장을 직접 확인했습니다. 글자마다 잉크 픽셀 수, 기준 이미지와의 이진 모양 차이(최대 30픽셀), 서로 다른 모양을 검사합니다. 작은 안티앨리어싱 차이는 허용하지만 빈 영역·누락 글리프·잘못된 한글 모양은 실패합니다. 도장은 테두리를 제외한 빨간 글자 픽셀과 별도의 테두리 픽셀을 확인합니다. 텍스트 추출 결과도 원문과 일치해야 합니다. 기준 이미지를 자동 갱신하지 마세요. 변경 시 실제 한글 모양 확인이 필요합니다.

이 자료는 한 가지 내장 TrueType 글꼴과 정적 인쇄 주석을 확인합니다. 임의 한글 글꼴, 브라우저 Worker, 모바일, 프린터 품질을 검증하지 않습니다.
