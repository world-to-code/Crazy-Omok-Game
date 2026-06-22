// 윷놀이 3D 씬 컨트롤러(Three.js).
// 말 = Kenney cube-pets GLB 모델(텍스처 임베드, idle/walk/run/dance/gesture 애니 내장).
// 보드 + 윷가락 던지기 + 모델 애니메이션(대기=idle, 이동=walk+점프, 승리=dance, 잡힘=gesture-negative).

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { BOARD_NODES, GOAL, HOME, nodePos, type NodeId } from "../board";
import type { MoveDetail } from "../engine";
import type { Piece, ThrowResult } from "../types";
import { zodiacOf, type Zodiac } from "../zodiac";

const R = 4.2; // 보드 반경(노드 좌표 [-1,1] → 월드 스케일)
const W = (x: number) => x * R;
const TOKEN_H = 1.15; // 말 모델 목표 높이(월드 단위)
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
  private throwAnim: { t: number; dur: number; result: ThrowResult; onDone: () => void } | null = null;
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
    this.scene.fog = new THREE.Fog(0x141017, 16, 36);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    this.camera.position.set(0, 14.5, 13.5);
    this.camera.lookAt(0, 0, 0);

    this.buildLights();
    this.buildBoard();
    this.buildSticks();
  }

  // ===== 구성 =====

  private buildLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.42));
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x261f33, 0.55));
    const key = new THREE.DirectionalLight(0xfff1d8, 1.25);
    key.position.set(6, 15, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const d = 13;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
    key.shadow.bias = -0.0005;
    key.shadow.radius = 3;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.4);
    rim.position.set(-8, 6, -7);
    this.scene.add(rim);
  }

  private buildBoard() {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(R * 2.5, 0.5, R * 2.5),
      new THREE.MeshStandardMaterial({ color: 0x2a1f17, roughness: 0.9 }),
    );
    plate.position.y = -0.25;
    plate.receiveShadow = true;
    this.scene.add(plate);

    const cloth = new THREE.Mesh(
      new THREE.BoxGeometry(R * 2.3, 0.04, R * 2.3),
      new THREE.MeshStandardMaterial({ color: 0xc7a36a, roughness: 0.95 }),
    );
    cloth.position.y = 0.02;
    cloth.receiveShadow = true;
    this.scene.add(cloth);

    const lineMat = new THREE.LineBasicMaterial({ color: 0x6b4a2e });
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i < 20; i++) {
      const p = nodePos(`o${i}`);
      ringPts.push(new THREE.Vector3(W(p.x), 0.05, W(p.y)));
    }
    ringPts.push(ringPts[0].clone());
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), lineMat));
    const diag = (ids: NodeId[]) => {
      const pts = ids.map((id) => {
        const p = nodePos(id);
        return new THREE.Vector3(W(p.x), 0.05, W(p.y));
      });
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    };
    diag(["o5", "a1", "c", "a2", "o15"]);
    diag(["o10", "b1", "c", "b2", "o0"]);

    for (const n of BOARD_NODES) {
      const big = n.corner || n.center;
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(big ? 0.46 : 0.3, big ? 0.46 : 0.3, 0.12, 24),
        new THREE.MeshStandardMaterial({
          color: n.center ? 0xe0a458 : big ? 0xd98f4e : 0xf0ddb6,
          roughness: 0.7,
        }),
      );
      disc.position.set(W(n.x), 0.08, W(n.y));
      disc.receiveShadow = true;
      this.scene.add(disc);
      // 모서리(모)·중앙(방) 강조 링.
      if (big) {
        const halo = new THREE.Mesh(
          new THREE.TorusGeometry(0.52, 0.05, 10, 28),
          new THREE.MeshStandardMaterial({ color: n.center ? 0xffcf6b : 0xe7a45a, emissive: n.center ? 0x7a5310 : 0x4a2f12, emissiveIntensity: 0.5 }),
        );
        halo.rotation.x = Math.PI / 2;
        halo.position.set(W(n.x), 0.15, W(n.y));
        this.scene.add(halo);
      }
    }

    // 보드 안내 라벨: 중앙 "방", 출발 지점.
    const banga = boardLabel("방");
    banga.scale.set(1.0, 0.5, 1);
    banga.position.set(0, 0.55, 0);
    this.scene.add(banga);
    const startP = nodePos("o0");
    const startLabel = boardLabel("출발");
    startLabel.scale.set(1.15, 0.55, 1);
    startLabel.position.set(W(startP.x), 0.6, W(startP.y));
    this.scene.add(startLabel);

    this.highlightRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.08, 12, 32),
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

  // 윷가락 쉬는 자리(앞쪽에 4개 나란히). 막대는 X축으로 누워 있으므로 간격은 Z축으로 줘야 겹치지 않는다.
  private stickRest(i: number): THREE.Vector3 {
    return new THREE.Vector3(0, 0.24, W(1.18) + (i - 1.5) * 0.52);
  }

  private buildSticks() {
    for (let i = 0; i < 4; i++) {
      const g = this.makeStick(i === 0); // 0번 = 백도 윷(빨간 표시)
      g.position.copy(this.stickRest(i));
      g.rotation.x = Math.PI; // 평소엔 배(하얀 면)가 위로 → 표시가 보임
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

    // 소유자 표시 받침 링(플레이어별 색).
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.09, 10, 28),
      new THREE.MeshStandardMaterial({
        color: OWNER_RING[owner % OWNER_RING.length],
        emissive: OWNER_EMIS[owner % OWNER_EMIS.length],
        emissiveIntensity: 0.5,
        roughness: 0.5,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.07;
    ring.castShadow = true;
    group.add(ring);

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

  // 플레이어별 대기/완주 구역 중심(보드 바깥 원형 분산). owner0 = 우하(출발 쪽), 시계 반대로.
  private ownerSpot(owner: number, radius: number): { x: number; y: number } {
    const n = Math.max(2, this.zodiacs.length);
    const ang = Math.PI * 0.25 - (owner * Math.PI * 2) / n; // owner0 = 45°(우하)
    return { x: Math.cos(ang) * radius, y: Math.sin(ang) * radius };
  }

  // 같은 칸의 내 말은 등에 업혀 쌓인다(piggyback). idx 0 바닥, 그 위로 적층.
  private slotPosition(p: Piece, slots: Map<string, number>): THREE.Vector3 {
    const key = `${p.owner}:${p.node}`;
    const idx = slots.get(key) ?? 0;
    slots.set(key, idx + 1);
    if (p.node === HOME) {
      const c = this.ownerSpot(p.owner, 1.32);
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      return new THREE.Vector3(W(c.x) + (col * 0.46 - 0.23), 0, W(c.y) + (row * 0.46 - 0.23));
    }
    if (p.node === GOAL) {
      // 완주 말은 자기 구역에 위로 쌓이는 더미(가로로 안 퍼져 판 밖으로 안 나감).
      const c = this.ownerSpot(p.owner, 1.52);
      return new THREE.Vector3(W(c.x), idx * 0.42, W(c.y));
    }
    return this.worldOf(p.node).setY(idx * 0.62); // 업기: 위로 쌓기
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

  throwYut(result: ThrowResult): Promise<void> {
    return new Promise((resolve) => {
      this.throwAnim = { t: 0, dur: 1.15, result, onDone: resolve };
    });
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
          rec.group.position.y + 2.0 + Math.sin(tsec * 4 + id) * 0.12,
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

    if (this.throwAnim) {
      const a = this.throwAnim;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      this.sticks.forEach((s, i) => {
        const rest = this.stickRest(i);
        s.position.x = rest.x;
        s.position.z = rest.z;
        s.position.y = rest.y + Math.sin(k * Math.PI) * (3.3 + i * 0.18);
        if (k < 0.82) {
          s.rotation.x += dt * (13 + i * 2);
          s.rotation.z = Math.sin(a.t * 9 + i) * 0.42;
        } else {
          // 배(하얀 면, 표시 있음)가 위 = 앞면. rotation.x = π.
          s.rotation.x = a.result.sticks[i] ? Math.PI : 0;
          s.rotation.z *= 0.7;
        }
      });
      if (k >= 1) {
        this.throwAnim = null;
        a.onDone();
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
