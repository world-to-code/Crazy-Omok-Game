// 윷놀이 3D 씬 컨트롤러(Three.js).
// 말 = Kenney cube-pets GLB 모델(텍스처 임베드, idle/walk/run/dance/gesture 애니 내장).
// 보드 + 윷가락 던지기 + 모델 애니메이션(대기=idle, 이동=walk+점프, 승리=dance, 잡힘=gesture-negative).

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BOARD_NODES, GOAL, HOME, nodePos, type NodeId } from "../board";
import type { MoveDetail } from "../engine";
import type { Piece, ThrowResult } from "../types";
import { zodiacOf, type Zodiac } from "../zodiac";

const R = 4.2; // 보드 반경(노드 좌표 [-1,1] → 월드 스케일)
const W = (x: number) => x * R;
const TOKEN_H = 1.3; // 말 모델 목표 높이(월드 단위)
const CLOTH = R * 1.17; // 놀이판(천) 반 변
const HOME_R = R * 1.45; // 대기 구역 중심까지 거리(판 바깥)
const PIECE_GAP = 1.1; // 대기 말 간격(받침이 겹치지 않게)
// 플레이어(owner)별 받침 링 색: 금/주홍/파랑/초록/보라.
const OWNER_RING = [0xe8b84b, 0xe0584b, 0x4f9be0, 0x57c06a, 0xb07ad0];
const OWNER_EMIS = [0x5a4310, 0x5a1a14, 0x123a5a, 0x14502a, 0x3a1a52];

interface Template {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  scale: number;
  yOffset: number;
}

interface TokenRec {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
}

// 키프레임 워킹: 각 말이 자기 점 목록(시작=실제위치 … 끝=정확한 슬롯)을 칸별로 통과.
// 모든 아이템의 pts 길이는 동일(같은 구간 수).
interface WalkItem {
  rec: TokenRec;
  pts: THREE.Vector3[];
}
interface WalkAnim {
  items: WalkItem[];
  seg: number;
  t: number;
  segDur: number;
  hop: number;
  onDone: () => void;
}
// 처치(제자리 패배: 솟구침 + 스핀 + 축소).
interface KillAnim {
  recs: TokenRec[];
  t: number;
  dur: number;
  onDone: () => void;
}

// 윷가락 한 개의 던지기 계획. 단계: 모으기(gather) → 젖히기(windup) → 비행(flight) → 튕김(bounce) → 안착(settle).
interface ThrowStick {
  start: THREE.Vector3; // 모으기 시작 위치(현재 위치)
  startQ: THREE.Quaternion;
  hand: THREE.Vector3; // 손에 쥔 묶음 위치
  handQ: THREE.Quaternion;
  windup: THREE.Vector3; // 던지기 직전 뒤로 젖힌 위치
  land: THREE.Vector3; // 첫 착지
  finalSpot: THREE.Vector3; // 굴러가 멈출 곳
  delay: number; // 막대마다 살짝 다른 출발 시각
  spin: THREE.Vector3; // 비행 중 회전 속도(로컬 축)
  faceUp: boolean; // 배(흰면)가 위 = 앞면
  offEdge: boolean; // 낙: 판 밖 테이블 위로
  yaw: number; // 안착 시 누운 방향
  bounces: { from: THREE.Vector3; to: THREE.Vector3; h: number; dur: number }[];
  hitIdx: number; // 지금까지 처리한 바닥 충돌 횟수(먼지·흔들림용)
  settleFrom?: THREE.Quaternion;
}

interface ThrowAnim {
  t: number; // 연출 시간(슬로모션 반영)
  p: number; // 세기 0~1
  gather: number; // 모으기 시간
  windup: number; // 젖히기 시간
  flight: number; // 비행 시간
  items: ThrowStick[];
  onDone: () => void;
}

// 이동 마커 1개 = 도착 칸 + 표시 정보 + 실제 적용할 수(throwIndex/key/route)를 함께 담는다.
export interface MoveMarkerSpec {
  to: NodeId;
  label: string;
  kind: "move" | "capture" | "finish";
  throwIndex: number;
  key: NodeId;
  route: "diag" | "straight";
}

export class YutScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private raf = 0;
  private clock = new THREE.Clock();
  private walkAnim: WalkAnim | null = null;
  private killAnim: KillAnim | null = null;

  private loader = new GLTFLoader();
  private templates = new Map<string, Template>();
  private tokens = new Map<number, TokenRec>();
  private sticks: THREE.Group[] = [];
  private throwAnim: ThrowAnim | null = null;
  // 기 모으기(버튼을 누르는 동안). charge = 현재 세기, holding = 지금 누르고 있는지.
  private charge = 0;
  private holding = false;
  // 착지 흔들림과 먼지.
  private camBase = new THREE.Vector3();
  private camLook = new THREE.Vector3(0, 0, 1.6);
  private shake = 0;
  private puffs: { m: THREE.Sprite; v: THREE.Vector3; life: number; max: number; s0: number }[] = [];
  private puffTex: THREE.Texture | null = null;
  private highlightRing: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();
  private selectable = new Set<number>();
  private indicators = new Map<number, THREE.Mesh>();
  private moveMarkers: THREE.Group[] = [];
  private selectedMarker: THREE.Group | null = null;
  private selectedId: number | null = null;
  private zodiacs: Zodiac[] = []; // owner 인덱스별 12지신

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x141017, 22, 50);

    // 판을 둘러싼 대기 말들까지 보이도록 약간 당겨 잡는다.
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 17, 12.5);
    this.camera.lookAt(this.camLook);
    this.camBase.copy(this.camera.position);

    this.buildLights();
    this.buildBoard();
    this.buildSticks();
  }

  // ===== 구성 =====

  private buildLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.42));
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x261f33, 0.55));
    const key = new THREE.DirectionalLight(0xfff1d8, 1.25);
    key.position.set(6, 16, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const d = 18;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 3;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.4);
    rim.position.set(-8, 6, -7);
    this.scene.add(rim);
  }

  private buildBoard() {
    // 나무 테이블(둥근 모서리) + 그 위에 놓인 놀이판(천). 선은 텍스처로 그려 굵고 또렷하게.
    const table = new THREE.Mesh(
      new RoundedBoxGeometry(R * 3.75, 0.5, R * 3.4, 3, 0.18),
      new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0x8a6446, roughness: 0.75 }),
    );
    table.position.set(0, -0.25, 0.35);
    table.receiveShadow = true;
    this.scene.add(table);

    // 판 테두리(진한 나무 프레임) — 천보다 살짝 크고 낮게.
    const frame = new THREE.Mesh(
      new RoundedBoxGeometry(CLOTH * 2 + 0.5, 0.16, CLOTH * 2 + 0.5, 2, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.6 }),
    );
    frame.position.y = 0.06;
    frame.castShadow = true;
    frame.receiveShadow = true;
    this.scene.add(frame);

    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(CLOTH * 2, CLOTH * 2),
      new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.95 }),
    );
    cloth.rotation.x = -Math.PI / 2;
    cloth.position.y = 0.145;
    cloth.receiveShadow = true;
    this.scene.add(cloth);

    for (const n of BOARD_NODES) {
      const big = n.corner || n.center;
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(big ? 0.5 : 0.32, big ? 0.54 : 0.35, 0.1, 32),
        new THREE.MeshStandardMaterial({
          color: n.center ? 0xe0a458 : big ? 0xd98f4e : 0xf0ddb6,
          roughness: 0.7,
        }),
      );
      disc.position.set(W(n.x), 0.2, W(n.y));
      disc.castShadow = true;
      disc.receiveShadow = true;
      this.scene.add(disc);
      // 모서리(모)·중앙(방) 강조 링.
      if (big) {
        const halo = new THREE.Mesh(
          new THREE.TorusGeometry(0.58, 0.05, 10, 32),
          new THREE.MeshStandardMaterial({ color: n.center ? 0xffcf6b : 0xe7a45a, emissive: n.center ? 0x7a5310 : 0x4a2f12, emissiveIntensity: 0.5 }),
        );
        halo.rotation.x = Math.PI / 2;
        halo.position.set(W(n.x), 0.25, W(n.y));
        this.scene.add(halo);
      }
    }

    // 보드 안내 라벨: 중앙 "방", 출발 지점.
    const banga = boardLabel("방");
    banga.scale.set(1.5, 0.75, 1);
    banga.position.set(0, 0.75, 0);
    this.scene.add(banga);
    const startP = nodePos("o0");
    const startLabel = boardLabel("출발");
    startLabel.scale.set(1.6, 0.8, 1);
    // 출발 칸 바로 바깥(앞쪽)에 띄워 말과 겹치지 않게.
    startLabel.position.set(W(startP.x) + 0.2, 0.5, W(startP.y) + 1.05);
    this.scene.add(startLabel);

    this.highlightRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.08, 12, 32),
      new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x2a7f43, emissiveIntensity: 0.7 }),
    );
    this.highlightRing.rotation.x = Math.PI / 2;
    this.highlightRing.visible = false;
    this.scene.add(this.highlightRing);

    // 선택된 말 강조: 청록 링 + 빛기둥(말을 따라다님).
    const selRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.66, 0.09, 14, 36),
      new THREE.MeshStandardMaterial({ color: 0x38e0ff, emissive: 0x17a6cc, emissiveIntensity: 1.1 }),
    );
    selRing.rotation.x = Math.PI / 2;
    selRing.position.y = 0.18;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 2.6, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x9be8ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.y = 1.4;
    const sel = new THREE.Group();
    sel.add(selRing);
    sel.add(beam);
    sel.visible = false;
    this.selectedMarker = sel;
    this.scene.add(sel);
  }

  // 윷가락 쉬는 자리(판 오른쪽 테이블 위에 4개 나란히). 막대가 z축으로 누워 있으므로 간격은 x축으로 준다.
  private stickRest(i: number): THREE.Vector3 {
    return new THREE.Vector3(CLOTH + 1.15 + i * 0.5, 0.22, 1.2);
  }

  private buildSticks() {
    for (let i = 0; i < 4; i++) {
      const g = this.makeStick(i === 0); // 0번 = 백도 윷(빨간 표시)
      g.position.copy(this.stickRest(i));
      g.rotation.set(Math.PI, Math.PI / 2, 0); // 배(하얀 면)가 위, 길이 방향은 z축
      this.sticks.push(g);
      this.scene.add(g);
    }
  }

  // 윷가락 1개: 둥근 등(브라운) + 납작한 배(크림) + 배에 X 표시 3개(백도는 빨강).
  private makeStick(backdo: boolean): THREE.Group {
    const g = new THREE.Group();
    const LEN = 1.95;
    // 둥근 몸통(등).
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, LEN, 22),
      new THREE.MeshStandardMaterial({ color: 0xb5824a, roughness: 0.85 }),
    );
    body.rotation.z = Math.PI / 2; // 길이축을 x로
    g.add(body);
    g.userData.bodyMat = body.material; // 기 모으기 때 달아오르는 빛
    // 납작한 배(크림 평면, 몸통 아래).
    const belly = new THREE.Mesh(
      new THREE.BoxGeometry(LEN, 0.06, 0.42),
      new THREE.MeshStandardMaterial({ color: 0xf3e7cf, roughness: 0.55 }),
    );
    belly.position.y = -0.19;
    g.add(belly);
    // 배 바깥면(아래)에 X 표시 3개. 백도는 빨강 + 가운데 원으로 확실히 구분.
    const my = -0.225;
    const markMat = new THREE.MeshStandardMaterial({ color: backdo ? 0xd2342f : 0x2a1c12, roughness: 0.5 });
    for (const mx of [-0.58, 0, 0.58]) {
      for (const rz of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.05), markMat);
        bar.position.set(mx, my, 0);
        bar.rotation.y = rz;
        g.add(bar);
      }
    }
    if (backdo) {
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.12, 20),
        new THREE.MeshStandardMaterial({ color: 0xd2342f, emissive: 0x5a0e0c, emissiveIntensity: 0.4 }),
      );
      dot.rotation.x = Math.PI / 2; // 바깥(아래)면을 향하게
      dot.position.set(0, my - 0.01, 0);
      g.add(dot);
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    return g;
  }

  // ===== 모델 로딩 =====

  // owner 인덱스 순서대로 12지신 지정(봇전=2, 멀티=2~5).
  setPlayers(zodiacs: Zodiac[]) {
    this.zodiacs = zodiacs;
  }

  private zodiacOfOwner(owner: number): Zodiac {
    return this.zodiacs[owner] ?? zodiacOf("tiger");
  }

  // 사용 모델 사전 로드(말 생성 전에 호출).
  async preload(animals: string[]): Promise<void> {
    await Promise.all(animals.map((a) => this.loadTemplate(a)));
  }

  private async loadTemplate(animal: string): Promise<Template> {
    const cached = this.templates.get(animal);
    if (cached) return cached;
    const gltf = await this.loader.loadAsync(`${import.meta.env.BASE_URL}models/animal-${animal}.glb`);
    const obj = gltf.scene;
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = TOKEN_H / Math.max(size.y, 0.001);
    const tpl: Template = { scene: obj, animations: gltf.animations, scale, yOffset: -box.min.y * scale };
    this.templates.set(animal, tpl);
    return tpl;
  }

  // ===== 말 토큰 =====

  private makeToken(z: Zodiac, owner: number): TokenRec {
    const tpl = this.templates.get(z.model)!;
    const group = new THREE.Group();

    // 소유자 표시 받침(플레이어별 색의 납작한 원판 + 밝은 테두리).
    const ownerMat = new THREE.MeshStandardMaterial({
      color: OWNER_RING[owner % OWNER_RING.length],
      emissive: OWNER_EMIS[owner % OWNER_EMIS.length],
      emissiveIntensity: 0.45,
      roughness: 0.45,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.12, 32), ownerMat);
    base.position.y = 0.06;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 32), ownerMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.12;
    group.add(rim);

    // 모델 인스턴스(애니 노드 보존 위해 SkeletonUtils.clone).
    const model = cloneSkeleton(tpl.scene);
    model.scale.setScalar(tpl.scale);
    model.position.y = tpl.yOffset + 0.12;
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(model);

    const mixer = new THREE.AnimationMixer(model);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of tpl.animations) {
      actions.set(clip.name, mixer.clipAction(clip));
    }
    const rec: TokenRec = { group, mixer, actions, current: "" };
    this.play(rec, "idle");
    return rec;
  }

  // 애니메이션 전환(크로스페이드).
  private play(rec: TokenRec, name: string, opts: { loop?: boolean; fade?: number } = {}) {
    if (rec.current === name) return;
    const next = rec.actions.get(name) ?? rec.actions.get("idle");
    if (!next) return;
    const fade = opts.fade ?? 0.2;
    const prev = rec.current ? rec.actions.get(rec.current) : undefined;
    next.reset();
    next.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = opts.loop === false;
    next.enabled = true;
    next.fadeIn(fade);
    next.play();
    if (prev && prev !== next) prev.fadeOut(fade);
    rec.current = name;
  }

  // ===== 상태 반영 =====

  // 상태에 맞춰 말을 즉시 배치(스냅). 애니메이션은 walkMovers/killAndReturn 담당.
  syncPieces(pieces: Piece[]) {
    const slots = this.slotMap(pieces);
    for (const p of pieces) {
      let rec = this.tokens.get(p.id);
      if (!rec) {
        rec = this.makeToken(this.zodiacOfOwner(p.owner), p.owner);
        rec.group.userData.pieceId = p.id; // 레이캐스트 픽용
        this.tokens.set(p.id, rec);
        this.scene.add(rec.group);
      }
      rec.group.scale.setScalar(1);
      rec.group.position.copy(slots.get(p.id)!);
      // 판 밖의 말은 판 가운데와 카메라 사이를 바라보게(옆모습·뒷모습이 되지 않게).
      if (p.node === HOME || p.node === GOAL) {
        const gp = rec.group.position;
        rec.group.rotation.y = Math.atan2(-gp.x * 0.5, this.camera.position.z - gp.z);
      }
      this.play(rec, p.done ? "dance" : "idle");
    }
  }

  private worldOf(node: NodeId): THREE.Vector3 {
    const p = nodePos(node);
    return new THREE.Vector3(W(p.x), 0, W(p.y));
  }

  // 모든 말의 슬롯 위치를 한 번에 계산(스택 인덱스 반영).
  private slotMap(pieces: Piece[]): Map<number, THREE.Vector3> {
    const counts = new Map<string, number>();
    const out = new Map<number, THREE.Vector3>();
    for (const p of pieces) out.set(p.id, this.slotPosition(p, counts));
    return out;
  }

  // 플레이어별 대기 구역 방향(판 바깥 원형 분산). owner0 = 앞(카메라 쪽), owner1 = 뒤 …
  // 앞뒤에 두면 말이 화면에 가로로 늘어서 서로 가리지 않는다.
  private ownerDir(owner: number): { x: number; y: number } {
    const n = Math.max(2, this.zodiacs.length);
    const ang = Math.PI / 2 - (owner * Math.PI * 2) / n; // π/2 = +z(앞)
    return { x: Math.cos(ang), y: Math.sin(ang) };
  }

  // 같은 칸의 내 말은 등에 업혀 쌓인다(piggyback). idx 0 바닥, 그 위로 적층.
  private slotPosition(p: Piece, slots: Map<string, number>): THREE.Vector3 {
    const key = `${p.owner}:${p.node}`;
    const idx = slots.get(key) ?? 0;
    slots.set(key, idx + 1);
    const d = this.ownerDir(p.owner);
    // 판 가장자리와 나란한 방향(접선).
    const tx = -d.y;
    const ty = d.x;
    if (p.node === HOME) {
      // 대기 말: 판 가장자리와 나란히 한 줄로(서로 가리지 않게).
      const k = idx - 1.5;
      return new THREE.Vector3(d.x * HOME_R + tx * k * PIECE_GAP, 0, d.y * HOME_R + ty * k * PIECE_GAP);
    }
    if (p.node === GOAL) {
      // 완주 말: 대기 구역 옆(판에서 더 바깥쪽)에 한 줄로.
      const k = idx - 1.5;
      return new THREE.Vector3(
        d.x * (HOME_R + PIECE_GAP * 1.6) + tx * k * PIECE_GAP,
        0,
        d.y * (HOME_R + PIECE_GAP * 1.6) + ty * k * PIECE_GAP,
      );
    }
    // 업기: 아래 말 등 위에 올라탄다(살짝 뒤로 비켜 얼굴이 가리지 않게).
    return this.worldOf(p.node).add(new THREE.Vector3(0, idx * TOKEN_H * 0.62, -idx * 0.12));
  }

  // 키프레임 워킹 프리미티브. 모든 아이템 pts 길이는 동일해야 한다.
  private walkAlong(items: WalkItem[], opts: { segDur: number; hop: number; anim: string }): Promise<void> {
    if (items.length === 0 || items[0].pts.length < 2) return Promise.resolve();
    for (const it of items) this.play(it.rec, opts.anim);
    return new Promise((resolve) => {
      this.walkAnim = { items, seg: 0, t: 0, segDur: opts.segDur, hop: opts.hop, onDone: resolve };
      this.faceWalkSegment();
    });
  }

  private faceWalkSegment() {
    const wa = this.walkAnim;
    if (!wa) return;
    for (const it of wa.items) {
      const a = it.pts[wa.seg];
      const b = it.pts[wa.seg + 1];
      if (!b) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.001) it.rec.group.rotation.y = Math.atan2(dx, dz);
    }
  }

  // 움직이는 말(업힌 그룹 포함)을 [실제 현재위치 → 중간 칸들 → 정확한 최종 슬롯]으로 걷게 한다.
  // 양 끝점을 실제 위치/슬롯으로 잡아 생략·튐이 없다.
  async walkMovers(detail: MoveDetail, finalPieces: Piece[]): Promise<void> {
    const slots = this.slotMap(finalPieces);
    const startCenter = this.worldOf(detail.startNode);
    const mids = detail.pathNodes.slice(0, -1).map((n) => this.worldOf(n)); // 마지막 칸은 슬롯으로 대체
    const items: WalkItem[] = [];
    for (const id of detail.moverIds) {
      const rec = this.tokens.get(id);
      const end = slots.get(id);
      if (!rec || !end) continue;
      // 대기칸 출발은 흩어져 있으니 오프셋 0(칸 중심 따라 걷기), 보드 위 스택은 오프셋 유지.
      const off =
        detail.startNode === HOME ? new THREE.Vector3() : rec.group.position.clone().sub(startCenter);
      const pts = [rec.group.position.clone(), ...mids.map((c) => c.clone().add(off)), end.clone()];
      items.push({ rec, pts });
    }
    await this.walkAlong(items, { segDur: 0.26, hop: 0.45, anim: "walk" });
    for (const it of items) this.play(it.rec, "idle");
  }

  // 처치 연출: 제자리 패배(솟구침 + 스핀 + 축소) → 대기칸으로 포물선 복귀.
  async killAndReturn(ids: number[], finalPieces: Piece[]): Promise<void> {
    const recs = ids.map((id) => this.tokens.get(id)).filter((r): r is TokenRec => !!r);
    if (recs.length === 0) return;
    for (const r of recs) this.play(r, "gesture-negative", { loop: false, fade: 0.08 });
    await new Promise<void>((resolve) => {
      this.killAnim = { recs, t: 0, dur: 0.55, onDone: resolve };
    });
    // 대기칸으로 복귀(스케일 회복 + 큰 포물선).
    const slots = this.slotMap(finalPieces);
    const items: WalkItem[] = [];
    for (const id of ids) {
      const rec = this.tokens.get(id);
      const end = slots.get(id);
      if (!rec || !end) continue;
      rec.group.scale.setScalar(1);
      items.push({ rec, pts: [rec.group.position.clone(), end.clone()] });
    }
    await this.walkAlong(items, { segDur: 0.42, hop: 1.1, anim: "walk" });
    for (const it of items) this.play(it.rec, "idle");
  }

  highlight(node: NodeId | null) {
    if (!this.highlightRing) return;
    if (!node || node === GOAL || node === HOME) {
      this.highlightRing.visible = false;
      return;
    }
    const p = nodePos(node);
    this.highlightRing.position.set(W(p.x), 0.12, W(p.y));
    this.highlightRing.visible = true;
  }

  // ===== 윷 던지기 =====

  // 손에 쥔 묶음 자세(세기 p에 따라 더 뒤로·높이 젖힘).
  private handPose(i: number, p: number): { pos: THREE.Vector3; q: THREE.Quaternion } {
    const pos = new THREE.Vector3(3.7 + (i - 1.5) * 0.17, 1.3 + p * 1.5, CLOTH + 1.0 + p * 0.8);
    // 길이축(x)이 위쪽·판 쪽을 향하도록 세워 쥔다. 막대마다 살짝 부채꼴로 벌어짐.
    const dir = new THREE.Vector3((i - 1.5) * 0.22, 1, -0.45 - p * 0.35).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    return { pos, q };
  }

  // 버튼을 누르는 동안 세기를 전달받아 윷을 모으고 떨게 한다.
  chargeYut(p: number) {
    this.charge = Math.max(0, Math.min(1, p));
    this.holding = p > 0;
  }

  // 윷을 던진다. power(0~1): 약하면 낮게 툭, 세면 높이 솟구쳐 빙글빙글 돌고 크게 튕긴다.
  // 낙이면 일부 윷가락이 판 밖 테이블 위로 떨어진다.
  throwYut(result: ThrowResult, power = 0.6): Promise<void> {
    const p = Math.max(0.15, Math.min(1, power));
    const wasHolding = this.holding;
    this.holding = false;
    this.charge = p;
    const R3 = () => Math.random() - 0.5;
    const edge = Math.random() < 0.5 ? -1 : 1; // 낙은 판 왼쪽/오른쪽 테이블 위로
    const fall = new Set<number>();
    if (result.nak) {
      const cnt = 1 + Math.floor(Math.random() * 2);
      while (fall.size < cnt) fall.add(Math.floor(Math.random() * 4));
    }
    const beyond = CLOTH + 0.75;
    const spread = 0.8 + p * 2.4; // 셀수록 넓게 흩어짐
    const items: ThrowStick[] = this.sticks.map((s, i) => {
      const hand = this.handPose(i, p);
      // 젖히기: 손 위치에서 더 뒤·위로(세게 던질수록 크게).
      const windup = hand.pos.clone().add(new THREE.Vector3(0.25, 0.3 + p * 0.7, 0.3 + p * 0.6));
      // 첫 착지: 약하면 판 앞쪽, 세면 판 깊숙이.
      const land = new THREE.Vector3(
        1.2 - p * 1.4 + R3() * spread * 1.6,
        0.36,
        3.2 - p * 4.6 + R3() * 1.2,
      );
      const offEdge = !!result.nak && fall.has(i);
      let finalSpot: THREE.Vector3;
      if (offEdge) {
        finalSpot = new THREE.Vector3(edge * (beyond + Math.random() * 0.6), 0.22, -1.5 + R3() * 3);
      } else {
        const ang = Math.random() * Math.PI * 2;
        const roll = 0.4 + p * 2.0 + Math.random() * 0.7;
        finalSpot = new THREE.Vector3(
          Math.max(-3.8, Math.min(3.8, land.x + Math.cos(ang) * roll)),
          0.36,
          Math.max(-3.6, Math.min(4.2, land.z + Math.sin(ang) * roll)),
        );
      }
      land.x = Math.max(-4.2, Math.min(4.2, land.x));
      // 튕김: 세기에 비례해 1~3번, 점점 낮고 짧게.
      const nb = 1 + Math.round(p * 2);
      const bounces: ThrowStick["bounces"] = [];
      let from = land.clone();
      for (let k = 0; k < nb; k++) {
        const f = (k + 1) / nb;
        const to = land.clone().lerp(finalSpot, 1 - Math.pow(1 - f, 1.6));
        to.y = k === nb - 1 ? finalSpot.y : 0.36;
        bounces.push({ from, to, h: (0.35 + p * 1.3) * Math.pow(0.42, k), dur: (0.2 + p * 0.16) * Math.pow(0.72, k) });
        from = to;
      }
      const spinK = 5 + p * 20;
      return {
        start: s.position.clone(),
        startQ: s.quaternion.clone(),
        hand: hand.pos,
        handQ: hand.q,
        windup,
        land,
        finalSpot,
        delay: i * (0.025 + p * 0.03),
        spin: new THREE.Vector3((0.6 + Math.random()) * spinK, R3() * spinK * 0.6, (0.8 + Math.random()) * spinK * (Math.random() < 0.5 ? -1 : 1)),
        faceUp: !!result.sticks[i],
        offEdge,
        yaw: (Math.random() - 0.5) * 1.1,
        bounces,
        hitIdx: 0,
      };
    });
    return new Promise((resolve) => {
      this.throwAnim = {
        t: 0,
        p,
        gather: wasHolding ? 0.08 : 0.4, // 봇은 짧게 모았다가 던짐
        windup: 0.14 + p * 0.16,
        flight: 0.5 + p * 0.5,
        items,
        onDone: resolve,
      };
    });
  }

  // 바닥 충돌: 먼지 + 화면 흔들림.
  private impact(at: THREE.Vector3, strength: number) {
    this.shake = Math.max(this.shake, strength);
    if (!this.puffTex) this.puffTex = puffTexture();
    const n = 4 + Math.round(strength * 8);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.puffTex, color: 0xe8d3a8, transparent: true, opacity: 0.8, depthWrite: false }),
      );
      const s0 = 0.25 + Math.random() * 0.25;
      m.scale.setScalar(s0);
      m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.1, (Math.random() - 0.5) * 0.6));
      const ang = Math.random() * Math.PI * 2;
      const sp = 0.8 + strength * 2.2 * Math.random();
      this.scene.add(m);
      this.puffs.push({ m, v: new THREE.Vector3(Math.cos(ang) * sp, 0.5 + Math.random() * 1.2, Math.sin(ang) * sp), life: 0, max: 0.5 + Math.random() * 0.4, s0 });
    }
  }

  // 정규화 좌표(nx,ny ∈ [-1,1])로 레이캐스트해 클릭된 말 id를 반환.
  pickPiece(nx: number, ny: number): number | null {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const groups = [...this.tokens.values()].map((r) => r.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData && o.userData.pieceId !== undefined) return o.userData.pieceId as number;
        o = o.parent;
      }
    }
    return null;
  }

  // 선택 가능한 말 위에 둥둥 뜨는 화살표 표시.
  setSelectable(ids: number[]) {
    this.selectable = new Set(ids);
  }

  // 현재 선택된 말(청록 강조 마커가 따라붙음). null이면 해제.
  setSelected(id: number | null) {
    this.selectedId = id;
  }

  private indicatorFor(id: number): THREE.Mesh {
    let m = this.indicators.get(id);
    if (!m) {
      m = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 0.42, 4),
        new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xc8861b, emissiveIntensity: 0.85, roughness: 0.4 }),
      );
      m.rotation.x = Math.PI; // 아래를 가리키게
      m.visible = false;
      this.indicators.set(id, m);
      this.scene.add(m);
    }
    return m;
  }

  // ===== 이동 가능 지점 마커(클릭형) =====

  // 각 마커에 이동 정보(throwIndex/key/route)를 직접 담는다 → 클릭한 마커 그대로 실행(인덱스 desync 없음).
  showMoves(moves: MoveMarkerSpec[]) {
    this.clearMoves();
    const byCell = new Map<NodeId, number[]>();
    moves.forEach((m, i) => {
      const a = byCell.get(m.to) ?? [];
      a.push(i);
      byCell.set(m.to, a);
    });
    moves.forEach((m, i) => {
      const peers = byCell.get(m.to)!;
      const base = this.worldOf(m.to);
      let ox = 0;
      let oz = 0;
      if (peers.length > 1) {
        const ang = (peers.indexOf(i) / peers.length) * Math.PI * 2;
        ox = Math.cos(ang) * 0.6;
        oz = Math.sin(ang) * 0.6;
      }
      const g = this.makeMoveMarker(m.kind, m.label, base.x + ox, base.z + oz);
      g.userData.move = m;
      this.moveMarkers.push(g);
      this.scene.add(g);
    });
  }

  clearMoves() {
    for (const g of this.moveMarkers) {
      this.scene.remove(g);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        } else if (o instanceof THREE.Sprite) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
    }
    this.moveMarkers = [];
  }

  pickMove(nx: number, ny: number): MoveMarkerSpec | null {
    if (this.moveMarkers.length === 0) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = this.raycaster.intersectObjects(this.moveMarkers, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData && o.userData.move) return o.userData.move as MoveMarkerSpec;
        o = o.parent;
      }
    }
    return null;
  }

  private makeMoveMarker(kind: "move" | "capture" | "finish", label: string, x: number, z: number): THREE.Group {
    const color = kind === "capture" ? 0xef4444 : kind === "finish" ? 0x38bdf8 : 0x4ade80;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    // 클릭 타겟 디스크.
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.52, 0.52, 0.14, 28),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, transparent: true, opacity: 0.5 }),
    );
    disc.position.y = 0.16;
    g.add(disc);
    // 링.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.58, 0.075, 12, 32),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.85 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    g.add(ring);
    // 라벨(윷 결과) 빌보드.
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(label, kind), depthWrite: false, depthTest: false }));
    spr.scale.set(1.25, 0.62, 1);
    spr.position.set(0, 1.6, 0);
    g.add(spr);
    return g;
  }

  // ===== 루프 =====

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.update(this.clock.getDelta());
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private update(dt: number) {
    for (const rec of this.tokens.values()) rec.mixer.update(dt);

    // 선택 가능 말 위 화살표(둥둥 + 회전). 단, 이미 선택된 말은 청록 마커로 대신 표시.
    const tsec = this.clock.elapsedTime;
    for (const [id, rec] of this.tokens) {
      if (this.selectable.has(id) && id !== this.selectedId) {
        const m = this.indicatorFor(id);
        m.visible = true;
        m.position.set(
          rec.group.position.x,
          rec.group.position.y + TOKEN_H + 0.75 + Math.sin(tsec * 4 + id) * 0.12,
          rec.group.position.z,
        );
        m.rotation.y += dt * 2.5;
      } else {
        const m = this.indicators.get(id);
        if (m) m.visible = false;
      }
    }

    // 선택된 말 강조 마커(따라다니며 펄스).
    if (this.selectedMarker) {
      const rec = this.selectedId != null ? this.tokens.get(this.selectedId) : null;
      if (rec) {
        this.selectedMarker.visible = true;
        this.selectedMarker.position.set(rec.group.position.x, 0, rec.group.position.z);
        const pulse = 1 + Math.sin(tsec * 5) * 0.07;
        this.selectedMarker.scale.set(pulse, 1, pulse);
        this.selectedMarker.rotation.y += dt * 1.3;
      } else {
        this.selectedMarker.visible = false;
      }
    }

    // 이동 마커: 회전 + 살짝 들썩.
    for (const g of this.moveMarkers) {
      g.rotation.y += dt * 1.6;
      const spr = g.children[2];
      if (spr) spr.position.y = 1.6 + Math.sin(tsec * 3.5) * 0.1;
    }

    // 키프레임 워킹(칸별 점프 호).
    if (this.walkAnim) {
      const wa = this.walkAnim;
      wa.t += dt;
      const k = Math.min(1, wa.t / wa.segDur);
      const hop = Math.sin(k * Math.PI) * wa.hop;
      for (const it of wa.items) {
        const p = it.pts[wa.seg].clone().lerp(it.pts[wa.seg + 1], k);
        p.y += hop;
        it.rec.group.position.copy(p);
      }
      if (k >= 1) {
        wa.seg += 1;
        wa.t = 0;
        if (wa.seg >= wa.items[0].pts.length - 1) {
          const done = wa.onDone;
          this.walkAnim = null;
          done();
        } else {
          this.faceWalkSegment();
        }
      }
    }

    // 처치(제자리 패배: 솟구침 + 스핀 + 축소).
    if (this.killAnim) {
      const ka = this.killAnim;
      ka.t += dt;
      const k = Math.min(1, ka.t / ka.dur);
      for (const r of ka.recs) {
        r.group.rotation.y += dt * 16;
        r.group.position.y = Math.sin(k * Math.PI) * 1.6;
        r.group.scale.setScalar(Math.max(0.3, 1 - 0.7 * k));
      }
      if (k >= 1) {
        const done = ka.onDone;
        this.killAnim = null;
        done();
      }
    }

    this.updateThrow(dt);
    this.updateFx(dt);
  }

  private updateThrow(rawDt: number) {
    const dt = Math.min(rawDt, 0.05);
    const tsec = this.clock.elapsedTime;
    const a = this.throwAnim;

    // 기 모으기: 묶음으로 모여 떨며 달아오른다.
    if (!a && this.holding) {
      const p = this.charge;
      const k = 1 - Math.exp(-dt * 12);
      this.sticks.forEach((s, i) => {
        const h = this.handPose(i, p);
        const tr = p * p * 0.07;
        h.pos.x += Math.sin(tsec * 47 + i * 2) * tr;
        h.pos.y += Math.sin(tsec * 39 + i) * tr;
        h.pos.z += Math.cos(tsec * 43 + i * 3) * tr;
        s.position.lerp(h.pos, k);
        s.quaternion.slerp(h.q, k);
      });
    }
    const glow = this.holding ? this.charge : a ? a.p * Math.max(0, 1 - a.t / (a.gather + a.windup + 0.3)) : 0;
    for (const s of this.sticks) {
      const m = s.userData.bodyMat as THREE.MeshStandardMaterial | undefined;
      if (m) {
        m.emissive.setHex(0xff6a1a);
        m.emissiveIntensity = glow * glow * 0.4 * (0.8 + Math.sin(tsec * 18) * 0.2);
      }
    }
    if (!a) return;

    // 세게 던지면 꼭대기 근처에서 슬로모션.
    const flightStart = a.gather + a.windup;
    const u0 = (a.t - flightStart) / a.flight;
    let scale = 1;
    if (a.p > 0.78 && u0 > 0.3 && u0 < 0.7) scale = 1 - 0.6 * Math.sin(((u0 - 0.3) / 0.4) * Math.PI);
    a.t += dt * scale;
    const t = a.t;

    let allDone = true;
    a.items.forEach((it, i) => {
      const s = this.sticks[i];
      const pos = new THREE.Vector3();
      if (t < a.gather) {
        // ① 모으기: 현재 자리에서 손 묶음으로.
        const f = t / a.gather;
        const e = f * f * (3 - 2 * f);
        pos.copy(it.start).lerp(it.hand, e);
        pos.y += Math.sin(f * Math.PI) * 0.6;
        s.quaternion.copy(it.startQ).slerp(it.handQ, e);
        allDone = false;
      } else if (t < flightStart + it.delay) {
        // ② 젖히기: 뒤로 크게 끌어당겼다가(예비 동작).
        const f = Math.min(1, (t - a.gather) / a.windup);
        const e = 1 - Math.pow(1 - f, 3);
        pos.copy(it.hand).lerp(it.windup, e);
        const back = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), e * (0.4 + a.p * 0.5));
        s.quaternion.copy(it.handQ).premultiply(back);
        allDone = false;
      } else if (t < flightStart + it.delay + a.flight) {
        // ③ 비행: 포물선(세기에 따라 높이). 빙글빙글 돈다.
        const u = (t - flightStart - it.delay) / a.flight;
        const peak = 1.2 + a.p * a.p * 5.2; // 최대 세기에도 화면 안에서 솟구치도록
        pos.copy(it.windup).lerp(it.land, u);
        pos.y = it.windup.y * (1 - u) + it.land.y * u + 4 * peak * u * (1 - u);
        s.rotateX(it.spin.x * dt * scale);
        s.rotateY(it.spin.y * dt * scale);
        s.rotateZ(it.spin.z * dt * scale);
        allDone = false;
      } else {
        // ④ 튕김: 닿을 때마다 먼지, 점점 낮게.
        let tb = t - flightStart - it.delay - a.flight;
        let k = 0;
        while (k < it.bounces.length && tb > it.bounces[k].dur) {
          tb -= it.bounces[k].dur;
          k++;
        }
        while (it.hitIdx <= Math.min(k, it.bounces.length - 1)) {
          const at = it.hitIdx === 0 ? it.land : it.bounces[it.hitIdx - 1].to;
          this.impact(at, (it.hitIdx === 0 ? 0.35 + a.p * 0.65 : 0.25 * a.p) * (i === 0 || it.hitIdx > 0 ? 1 : 0.6));
          it.hitIdx++;
        }
        if (k < it.bounces.length) {
          const b = it.bounces[k];
          const f = tb / b.dur;
          pos.copy(b.from).lerp(b.to, f);
          pos.y = b.from.y * (1 - f) + b.to.y * f + 4 * b.h * f * (1 - f);
          const slow = 0.5 * Math.pow(0.55, k);
          s.rotateX(it.spin.x * dt * slow);
          s.rotateZ(it.spin.z * dt * slow);
          allDone = false;
        } else {
          // ⑤ 안착: 평평하게 눕는다.
          const st = tb;
          if (!it.settleFrom) it.settleFrom = s.quaternion.clone();
          const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(it.faceUp ? Math.PI : 0, it.yaw, 0, "YXZ"));
          const e = Math.min(1, st / 0.22);
          s.quaternion.copy(it.settleFrom).slerp(target, e * e * (3 - 2 * e));
          pos.copy(it.finalSpot);
          pos.y = it.finalSpot.y + 0.1 * (1 - e);
          if (e < 1) allDone = false;
        }
      }
      s.position.copy(pos);
    });
    if (allDone) {
      this.throwAnim = null;
      this.charge = 0;
      a.onDone();
    }
  }

  // 화면 흔들림·먼지 갱신.
  private updateFx(rawDt: number) {
    const dt = Math.min(rawDt, 0.05);
    const t = this.clock.elapsedTime;
    if (this.shake > 0.001) {
      const a = this.shake * 0.28;
      this.camera.position.set(
        this.camBase.x + Math.sin(t * 61) * a,
        this.camBase.y + Math.sin(t * 53 + 1) * a,
        this.camBase.z + Math.cos(t * 57) * a * 0.6,
      );
      this.camera.lookAt(this.camLook);
      this.shake = Math.max(0, this.shake - dt * 3.2);
      if (this.shake <= 0.001) {
        this.camera.position.copy(this.camBase);
        this.camera.lookAt(this.camLook);
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life += dt;
      p.v.multiplyScalar(1 - dt * 3);
      p.m.position.addScaledVector(p.v, dt);
      const f = p.life / p.max;
      p.m.scale.setScalar(p.s0 * (1 + f * 2.2));
      p.m.material.opacity = 0.75 * (1 - f);
      if (f >= 1) {
        this.scene.remove(p.m);
        p.m.material.dispose();
        this.puffs.splice(i, 1);
      }
    }
  }

  resize(w: number, h: number) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.clearMoves();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.renderer.dispose();
  }
}

// 보드 안내 라벨(방/출발 등) — 투명 배경 + 외곽선 글자 빌보드.
function boardLabel(text: string): THREE.Sprite {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 128;
  const ctx = cv.getContext("2d")!;
  ctx.font = "bold 70px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 9;
  ctx.strokeStyle = "rgba(24,14,8,.92)";
  ctx.strokeText(text, 128, 66);
  ctx.fillStyle = "#f6ecd6";
  ctx.fillText(text, 128, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
}

// 이동 마커 라벨(윷 결과) 텍스처. 캔버스로 둥근 배지 + 글자.
function labelTexture(text: string, kind: "move" | "capture" | "finish"): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 128;
  const ctx = cv.getContext("2d")!;
  const bg = kind === "capture" ? "#7f1d1d" : kind === "finish" ? "#075985" : "#166534";
  const r = 22;
  ctx.beginPath();
  ctx.moveTo(20 + r, 28);
  ctx.arcTo(236, 28, 236, 100, r);
  ctx.arcTo(236, 100, 20, 100, r);
  ctx.arcTo(20, 100, 20, 28, r);
  ctx.arcTo(20, 28, 236, 28, r);
  ctx.closePath();
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 50px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 놀이판 천 텍스처: 한지 느낌 바탕 + 굵은 먹선 길 + 테두리 장식.
function boardTexture(): THREE.CanvasTexture {
  const S = 1024;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, "#efd9ab");
  g.addColorStop(1, "#d8b77c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // 종이 결(잔 점).
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(120,80,40,${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  // 테두리 이중선.
  ctx.strokeStyle = "#8a5a32";
  ctx.lineWidth = 10;
  ctx.strokeRect(22, 22, S - 44, S - 44);
  ctx.lineWidth = 3;
  ctx.strokeRect(40, 40, S - 80, S - 80);
  // 노드 좌표 [-1,1] → 텍스처 픽셀(천 반 변 = CLOTH).
  const px = (v: number) => S / 2 + ((v * R) / CLOTH) * (S / 2);
  ctx.strokeStyle = "#6b4226";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const path = (ids: NodeId[], close = false) => {
    ctx.beginPath();
    ids.forEach((id, i) => {
      const p = nodePos(id);
      if (i === 0) ctx.moveTo(px(p.x), px(p.y));
      else ctx.lineTo(px(p.x), px(p.y));
    });
    if (close) ctx.closePath();
    ctx.stroke();
  };
  path(Array.from({ length: 20 }, (_, i) => `o${i}`), true);
  path(["o5", "a1", "a2", "c", "a3", "a4", "o15"]);
  path(["o10", "b1", "b2", "c", "b3", "b4", "o0"]);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 테이블 나뭇결 텍스처.
function woodTexture(): THREE.CanvasTexture {
  const W2 = 512, H2 = 512;
  const cv = document.createElement("canvas");
  cv.width = W2;
  cv.height = H2;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#b08560";
  ctx.fillRect(0, 0, W2, H2);
  for (let y = 0; y < H2; y += 2) {
    const n = Math.sin(y * 0.09) * 0.5 + Math.sin(y * 0.023 + 1.3) * 0.5;
    ctx.fillStyle = `rgba(70,40,20,${0.08 + Math.abs(n) * 0.12})`;
    ctx.fillRect(0, y, W2, 1 + (Math.random() < 0.1 ? 1 : 0));
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

// 먼지 입자 텍스처(부드러운 원).
function puffTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
