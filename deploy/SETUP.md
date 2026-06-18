# 배포 가이드 (AWS EC2 + GitHub Actions)

`main` 에 push 하면 `.github/workflows/deploy.yml` 가 자동으로:
1. 프론트(`web/dist`) + Rust 정적 바이너리(`omok-server`) 빌드
2. EC2 로 전송
3. `/opt/omok` 에 배치하고 `systemctl restart omok` 으로 재시작

> 이 프로젝트는 Java(jar)가 아니라 **Rust 단일 실행 바이너리**를 배포합니다.

아래 **1~5번은 서버에서 최초 1회만** 설정하면 됩니다. 이후부터는 push 만으로 배포됩니다.

---

## 1. GitHub 리포지토리 Secrets 등록

`Settings → Secrets and variables → Actions → New repository secret`

| 이름 | 값 | 비고 |
| --- | --- | --- |
| `DEPLOY_HOST` | EC2 공인 IP 또는 `omok.ascode.click` | |
| `DEPLOY_USER` | `ubuntu` (Amazon Linux 면 `ec2-user`) | |
| `DEPLOY_SSH_KEY` | EC2 접속용 **개인키 전체 내용**(`-----BEGIN ...`) | |
| `DEPLOY_PORT` | `22` | 생략 가능(기본 22) |

## 2. EC2 보안 그룹 / 방화벽

- 인바운드 **80(TCP)** 허용 (게임 접속용)
- 인바운드 **22(TCP)** 허용 (배포 SSH용, 가능하면 본인 IP로 제한)

## 3. 앱 디렉터리 + 환경 변수 (.env)

```bash
sudo mkdir -p /opt/omok/web
sudo chown -R $USER:$USER /opt/omok     # 배포 사용자가 파일을 쓸 수 있게

cat > /opt/omok/.env <<'EOF'
OMOK_BIND=0.0.0.0
OMOK_PORT=80
OMOK_PUBLIC_HOST=omok.ascode.click
OMOK_PUBLIC_PORT=80
OMOK_WEB_DIR=/opt/omok/web/dist
EOF
```

> `.env` 는 서버에만 두고 git 에는 올리지 않습니다(`.gitignore` 처리됨).
> `OMOK_WEB_DIR` 는 **절대경로**로 둡니다(서비스 작업 디렉터리가 `/opt/omok` 라서).

## 4. systemd 서비스 등록

`deploy/omok.service` 의 `User=` 를 배포 사용자에 맞게 확인한 뒤:

```bash
sudo cp deploy/omok.service /etc/systemd/system/omok.service
# (User 가 ubuntu 가 아니면 sudo nano /etc/systemd/system/omok.service 로 수정)
sudo systemctl daemon-reload
sudo systemctl enable omok
```

첫 배포(아래 6번) 후 `omok-server` 바이너리가 생기면 자동 실행됩니다.
바이너리가 아직 없다면 `start` 는 첫 배포 후에 동작합니다.

## 5. 배포 사용자에게 서비스 재시작 권한 부여 (sudoers)

CI 가 비밀번호 없이 서비스를 재시작할 수 있어야 합니다.

```bash
echo "$USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart omok, /usr/bin/systemctl start omok, /usr/bin/systemctl stop omok, /usr/bin/systemctl reset-failed omok, /usr/bin/systemctl is-active omok, /usr/bin/systemctl enable omok" | sudo tee /etc/sudoers.d/omok
sudo chmod 440 /etc/sudoers.d/omok
```

> `systemctl` 경로가 다르면(`which systemctl`) 그 경로로 맞추세요.

## 6. 첫 배포

`main` 에 push 하거나 GitHub Actions 에서 **Run workflow(workflow_dispatch)** 실행.
끝나면 `http://omok.ascode.click/` 로 접속됩니다.

```bash
# 서버에서 상태/로그 확인
sudo systemctl status omok
journalctl -u omok -f
```

---

## 참고

- 배포 시 서버가 재시작되며 **진행 중이던 모든 방/게임은 사라집니다**(인메모리). 접속 중이던 브라우저는 자동 재연결되어 홈으로 돌아갑니다.
- HTTPS 가 필요해지면 앞단에 nginx/ALB 를 두고 `OMOK_BIND=127.0.0.1`, `OMOK_PORT=8080`, `OMOK_PUBLIC_PORT=443` 로 바꾸면 됩니다. (WebSocket `/ws` 업그레이드 헤더 전달 필요)
