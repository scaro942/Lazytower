# Tower — 로그라이크 탑 등반

스컬 · 던전 슬래셔 · 탑 등반물을 섞은 2D 액션 로그라이크.
서버가 필요 없는 순수 정적 웹앱입니다. (진행도는 브라우저에 저장)

---

## 📱 아이패드에서 Netlify에 올리기 (가장 쉬운 방법)

아이패드에는 개발 도구가 없어서, **GitHub에 코드를 올리면 Netlify가 알아서
빌드해주는** 방식이 가장 쉽습니다. 아래만 따라 하면 됩니다.

### 1단계 — GitHub 계정 만들기 (이미 있으면 건너뛰기)
사파리에서 https://github.com 접속 → Sign up → 무료 계정 생성.

### 2단계 — 새 저장소(repository) 만들기
1. GitHub 오른쪽 위 `+` → **New repository**.
2. Repository name에 `tower-game` 입력.
3. **Public** 선택. (Private도 되지만 Public이 간단)
4. 아래 초록 버튼 **Create repository** 탭.

### 3단계 — 파일 올리기
1. 방금 만든 저장소 화면에서 **uploading an existing file** 링크를 탭.
   (또는 `Add file → Upload files`)
2. 이 zip 안에 들어있던 **모든 파일과 폴더**를 선택해 올립니다.
   - 아이패드 "파일" 앱에서 이 zip을 길게 눌러 **압축 해제**한 뒤,
     생긴 `tower-web` 폴더 안의 내용물을 전부 선택해서 드래그하면 됩니다.
   - ⚠️ `tower-web` 폴더째로 올리지 말고, **폴더 안의 내용물**을 올리세요.
     (`index.html`, `package.json`, `src` 폴더 등이 최상단에 오도록)
3. 맨 아래 초록 버튼 **Commit changes** 탭.

### 4단계 — Netlify에 연결
1. 사파리에서 https://app.netlify.com 접속 → GitHub 계정으로 로그인
   (**Log in with GitHub**를 누르면 가장 간편).
2. **Add new site → Import an existing project**.
3. **Deploy with GitHub** 선택 → 방금 만든 `tower-game` 저장소 선택.
4. 빌드 설정은 이 프로젝트의 `netlify.toml`이 자동으로 채워줍니다.
   화면에 이렇게 떠 있으면 정상입니다:
   - Build command: `npm run build`
   - Publish directory: `dist`
5. **Deploy** 버튼 탭.

### 5단계 — 완성
1~2분 뒤 `https://랜덤이름.netlify.app` 주소가 생기고, 탭하면 게임이 뜹니다.
주소는 Site configuration → Change site name 에서 원하는 이름으로 바꿀 수 있어요.

> 이후 코드를 고치고 싶으면, GitHub에서 파일을 수정하고 Commit만 하면
> Netlify가 **자동으로 다시 빌드·배포**합니다.

---

## 🎮 조작

- 이동: A/D 또는 ←/→
- 점프(이단/삼단): Space · W · ↑
- 대시: Shift
- 공격(3타 콤보): J
- 스킬: K · L · I
- 상호작용(문 진입): E 또는 ↓

> 참고: 지금은 키보드 조작 기준입니다. 아이패드에서 손가락으로 하려면
> 화면 터치 컨트롤이 필요한데, 원하면 추가할 수 있습니다.

---

## 💻 컴퓨터가 있다면 (참고)

Node.js 18+ 가 설치된 PC/맥에서는 로컬 실행도 됩니다.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 정적 파일 생성
```

## 구조
- `src/lib/game/tower.ts` — 게임 엔진 (물리, 적/보스 AI, 층·전직 시스템, 렌더링)
- `src/components/TowerGame.tsx` — React UI (로비, HUD, 오버레이)
- `src/styles.css` — 디자인 토큰 / 스타일
- `netlify.toml` — Netlify 빌드 설정 (자동 인식됨)
