//! 오목 서버: axum 단일 바이너리가 정적 프론트(web/dist)와 WebSocket을 함께 서빙.
mod chess;
mod flick;
mod game;
mod protocol;
mod state;
mod ws;
mod yut;

use std::sync::Arc;

use axum::extract::State;
use axum::routing::get;
use axum::Router;
use tower_http::services::{ServeDir, ServeFile};

use state::AppState;

#[tokio::main]
async fn main() {
    // .env 가 있으면 로드 (실제 환경 변수가 우선).
    dotenvy::dotenv().ok();

    let bind = env_or("OMOK_BIND", "0.0.0.0");
    let port: u16 = env_or("OMOK_PORT", "8080").parse().unwrap_or(8080);

    // 초대 링크용 공개 호스트: 미설정 시 자동 감지된 LAN IP.
    let public_host = std::env::var("OMOK_PUBLIC_HOST")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| detect_lan_ip().unwrap_or_else(|| "127.0.0.1".to_string()));
    // 초대 링크용 공개 포트: 미설정 시 바인딩 포트와 동일.
    let public_port: u16 = std::env::var("OMOK_PUBLIC_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(port);

    let state = Arc::new(AppState::new(public_host.clone(), public_port));
    // 빈 방을 주기적으로 회수(메모리 절약).
    ws::spawn_room_janitor(state.clone());

    // 빌드된 프론트 위치 (기본 ../web/dist, 환경변수로 변경 가능).
    let dist = env_or("OMOK_WEB_DIR", "../web/dist");
    let index = format!("{dist}/index.html");
    // SPA: 정적 파일 우선, 없으면 index.html로 폴백.
    let static_service = ServeDir::new(&dist).not_found_service(ServeFile::new(index));

    let app = Router::new()
        .route("/ws", get(ws::ws_handler))
        .route("/api/ip", get(server_ip))
        .fallback_service(static_service)
        .with_state(state);

    let addr = format!("{bind}:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("{addr} 바인딩 실패: {e}"));
    println!("오목 서버 실행 중: http://{addr}");
    println!("초대 주소: {}", public_base(&public_host, public_port));
    // 클라이언트 IP를 얻기 위해 ConnectInfo 사용.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .expect("서버 실행 실패");
}

/// 초대 링크에 쓸 공개 호스트/포트를 반환.
async fn server_ip(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "ip": state.public_host,
        "port": state.public_port,
    }))
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default.to_string())
}

/// 표시용 공개 베이스 URL (80/443 포트는 생략).
fn public_base(host: &str, port: u16) -> String {
    if port == 80 {
        format!("http://{host}")
    } else if port == 443 {
        format!("https://{host}")
    } else {
        format!("http://{host}:{port}")
    }
}

/// UDP 소켓의 라우팅을 이용해 외부로 나가는 인터페이스의 사설 IP를 추정.
/// (실제 패킷은 전송하지 않음)
fn detect_lan_ip() -> Option<String> {
    use std::net::UdpSocket;
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    Some(sock.local_addr().ok()?.ip().to_string())
}
