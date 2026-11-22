// 요트 3D 씬: 주사위 5개 + 컵. 컵을 드래그로 흔들고(연출), 놓으면 주사위가 판 위로
// 쏟아져 텀블 후 서버/엔진이 정한 눈으로 안착. 킵된 주사위는 제자리, 리롤만 다시 던진다.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const DIE = 0.92; // 주사위 한 변
const SPOTS_Z = 1.2; // 주사위가 놓이는 줄의 z
const SPOTS_X = -0.9; // 주사위 줄 중심 x(컵이 가리지 않게 왼쪽으로)
const CUP = { x: 3.6, y: 0, z: 4.0 }; // 컵 위치(오른쪽 앞, 주사위 줄을 가리지 않게)
const CUP_R_TOP = 1.55; // 컵 입구 반지름
const CUP_R_BOT = 1.35; // 컵 바닥 반지름
const CUP_H = 2.3; // 컵 높이
// 컵 안 주사위 배치(아래 3개 삼각형 + 위 2개). 서로·벽과 겹치지 않게 고정 슬롯을 쓴다.
const CUP_SLOTS: [number, number, number][] = [
  [0, DIE / 2 + 0.06, -0.58],
  [-0.52, DIE / 2 + 0.06, 0.32],
  [0.52, DIE / 2 + 0.06, 0.32],
  [-0.3, DIE * 1.5 + 0.1, -0.05],
  [0.36, DIE * 1.5 + 0.1, 0.12],
];

// value(1~6)를 윗면으로 만드는 오일러 회전.
const TOP_EULER: Record<number, [number, number, number]> = {
  1: [0, 0, 0],
  2: [0, 0, Math.PI / 2],
  3: [-Math.PI / 2, 0, 0],
  4: [Math.PI / 2, 0, 0],
  5: [0, 0, -Math.PI / 2],
  6: [Math.PI, 0, 0],
};

interface DieRec {
  mesh: THREE.Mesh;
  spot: THREE.Vector3; // 테이블 위 제자리
  inCup: boolean; // 컵 안에서 대기/흔들림 중
  cupOff: THREE.Vector3; // 컵 내부 기준 위치
  rPhase: number; // 흔들림 위상(주사위마다 다르게)
}

interface ThrowAnim {
  items: { die: DieRec; from: THREE.Vector3; to: THREE.Vector3; value: number; yaw: number; spin: THREE.Vector3 }[];
  t: number;
  dur: number;
  onDone: () => void;
}

export class YachtScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private raf = 0;
  private clock = new THREE.Clock();
  private dice: DieRec[] = [];
  private cup: THREE.Group;
  private shakeLevel = 0;
  private throwAnim: ThrowAnim | null = null;
  private tmp = new THREE.Vector3();
  // 컵 잡기·끌기 상태. base = 지터를 뺀 컵 위치, vel = 컵 속도(월드).
  private held = false;
  private cupTarget = new THREE.Vector3(CUP.x, 0, CUP.z);
  private cupBase = new THREE.Vector3(CUP.x, 0, CUP.z);
  private cupVel = new THREE.Vector3();
  private cupSpin = 0; // 컵 자체 회전(돌리면 안의 주사위도 함께 돈다)
  private throwYaw = 0;
  private raycaster = new THREE.Raycaster();
  private tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x12111a, 20, 42);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0.6, 10.5, 10.5);
    this.camera.lookAt(0.6, 0, 2.4);

    this.buildLights();
    this.buildTable();
    this.cup = this.buildCup();
    this.scene.add(this.cup);
    this.buildDice();
  }

  private buildLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x20202e, 0.5));
    const key = new THREE.DirectionalLight(0xfff1d8, 1.2);
    key.position.set(5, 12, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const d = 10;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.03;
    this.scene.add(key);
  }

  private buildTable() {
    const W = 14, D = 12, Z = 2.0; // 펠트 크기와 중심 z
    const felt = new THREE.Mesh(
      new THREE.BoxGeometry(W, 0.4, D),
      new THREE.MeshStandardMaterial({ color: 0x1f6b46, roughness: 0.95 }),
    );
    felt.position.set(0, -0.2, Z); // 윗면 y=0
    felt.receiveShadow = true;
    this.scene.add(felt);
    // 가장자리 나무 테두리: 펠트를 감싸는 네 개의 막대(펠트 윗면과 겹치지 않게 위로 올림).
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: 0.7 });
    const T = 0.45, H = 0.75; // 두께, 높이(펠트 아래 0.45 ~ 위 0.3)
    const bars: [number, number, number, number][] = [
      [W + T * 2, T, 0, Z - D / 2 - T / 2],
      [W + T * 2, T, 0, Z + D / 2 + T / 2],
      [T, D, -W / 2 - T / 2, Z],
      [T, D, W / 2 + T / 2, Z],
    ];
    for (const [w, d, x, z] of bars) {
      const m = new RoundedBoxGeometry(w, H, d, 2, 0.08);
      const bar = new THREE.Mesh(m, wood);
      bar.position.set(x, H / 2 - 0.45, z);
      bar.castShadow = true;
      bar.receiveShadow = true;
      this.scene.add(bar);
    }
  }

  private buildCup(): THREE.Group {
    const g = new THREE.Group();
    const outer = new THREE.MeshStandardMaterial({ color: 0x8a3b2a, roughness: 0.45, metalness: 0.05 });
    const inner = new THREE.MeshStandardMaterial({ color: 0x7a3526, roughness: 0.9, side: THREE.BackSide });
    const T = 0.08; // 벽 두께
    // 바깥 벽(앞면만)과 안쪽 벽(뒷면만)을 따로 그려 벽에 두께가 보이게 한다.
    const outerWall = new THREE.Mesh(new THREE.CylinderGeometry(CUP_R_TOP + T, CUP_R_BOT + T, CUP_H, 40, 1, true), outer);
    outerWall.position.y = CUP_H / 2;
    outerWall.castShadow = true;
    g.add(outerWall);
    const innerWall = new THREE.Mesh(new THREE.CylinderGeometry(CUP_R_TOP, CUP_R_BOT, CUP_H, 40, 1, true), inner);
    innerWall.position.y = CUP_H / 2;
    g.add(innerWall);
    // 입구 테두리(링)와 바닥.
    const lip = new THREE.Mesh(new THREE.TorusGeometry(CUP_R_TOP + T / 2, T * 0.75, 10, 48), outer);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = CUP_H;
    lip.castShadow = true;
    g.add(lip);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(CUP_R_BOT + T, CUP_R_BOT + T, 0.08, 40), outer);
    base.position.y = 0.04;
    base.receiveShadow = true;
    g.add(base);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(CUP_R_BOT, 40),
      new THREE.MeshStandardMaterial({ color: 0x5c2a1e, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.081;
    floor.receiveShadow = true;
    g.add(floor);
    g.position.set(CUP.x, 0, CUP.z);
    g.rotation.order = "YXZ"; // 회전(yaw) 뒤에 기울기를 컵 기준으로 적용
    return g;
  }

  private buildDice() {
    const mats = [2, 5, 1, 6, 3, 4].map(
      (v) => new THREE.MeshStandardMaterial({ map: pipTexture(v), roughness: 0.4 }),
    );
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(DIE, DIE, DIE, 4, DIE * 0.12), mats);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const spot = new THREE.Vector3(SPOTS_X + (i - 2) * 1.25, DIE / 2, SPOTS_Z);
      mesh.position.copy(spot);
      this.setTop(mesh, 1, 0);
      this.scene.add(mesh);
      this.dice.push({ mesh, spot, inCup: false, cupOff: new THREE.Vector3(), rPhase: i * 1.7 });
    }
  }

  // 컵 안 슬롯을 섞어 배정(겹치지 않는 고정 위치 + 약간의 흔들림).
  private assignCupSlots(idx: number[]) {
    const order = [...CUP_SLOTS.keys()].sort(() => Math.random() - 0.5);
    // 던질 개수가 적으면 아래층부터 채운다.
    order.sort((a, b) => CUP_SLOTS[a][1] - CUP_SLOTS[b][1]);
    idx.forEach((di, k) => {
      const [x, y, z] = CUP_SLOTS[order[k]];
      this.dice[di].cupOff.set(x + (Math.random() - 0.5) * 0.08, y, z + (Math.random() - 0.5) * 0.08);
    });
  }

  // 주사위 mesh를 value가 윗면이 되도록 회전(+추가 yaw).
  private setTop(mesh: THREE.Mesh, value: number, yaw: number) {
    const [rx, ry, rz] = TOP_EULER[value] ?? [0, 0, 0];
    mesh.quaternion.setFromEuler(new THREE.Euler(rx, ry + yaw, rz, "XYZ"));
  }

  // ===== 외부 제어 =====

  // 현재 주사위 상태 즉시 반영(킵된 건 제자리, 전부 테이블 위).
  setDice(values: number[], keep: boolean[]) {
    this.dice.forEach((d, i) => {
      d.inCup = false;
      d.mesh.position.copy(d.spot);
      // 킵 표시: 살짝 들어올리고 금빛(테두리). 여기선 살짝 띄움 + 회전 고정.
      d.mesh.position.y = keep[i] ? DIE / 2 + 0.18 : DIE / 2;
      this.setTop(d.mesh, values[i] || 1, 0);
    });
  }

  // 굴리기 전: 던질 주사위(!keep, firstRoll이면 전부)를 컵 안에 넣는다. 킵된 건 테이블.
  loadCup(values: number[], keep: boolean[], firstRoll: boolean) {
    const toCup: number[] = [];
    this.dice.forEach((_, i) => {
      if (firstRoll || !keep[i]) toCup.push(i);
    });
    this.assignCupSlots(toCup);
    this.dice.forEach((d, i) => {
      if (firstRoll || !keep[i]) {
        d.inCup = true;
        this.setTop(d.mesh, values[i] || 1, Math.random() * Math.PI);
      } else {
        d.inCup = false;
        d.mesh.position.copy(d.spot);
        d.mesh.position.y = DIE / 2 + 0.18;
        this.setTop(d.mesh, values[i] || 1, 0);
      }
    });
  }

  // 화면 정규화 좌표(nx,ny ∈ [-1,1])를 테이블 위 점으로. 컵이 펠트 밖으로 나가지 않게 제한.
  private toTable(nx: number, ny: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.tablePlane, hit)) return null;
    hit.x = Math.max(-5.2, Math.min(5.2, hit.x));
    hit.z = Math.max(-2.2, Math.min(6.4, hit.z));
    hit.y = 0;
    return hit;
  }

  // 컵 잡기: 들어 올려 포인터를 따라오게 한다.
  grabCup(nx: number, ny: number) {
    this.held = true;
    const p = this.toTable(nx, ny);
    // 잡은 지점이 컵과 멀면 컵이 그쪽으로 스르륵 따라온다.
    this.cupTarget.copy(p ?? this.cupBase);
  }

  dragCup(nx: number, ny: number) {
    if (!this.held) return;
    const p = this.toTable(nx, ny);
    if (p) this.cupTarget.copy(p);
  }

  releaseCup() {
    this.held = false;
  }

  setShake(level: number) {
    this.shakeLevel = Math.max(this.shakeLevel, Math.min(1, level));
  }

  // 던지기: 리롤 대상(!keep, 또는 firstRoll이면 전부)을 컵에서 판 위로 쏟아 안착.
  throwDice(values: number[], keep: boolean[], firstRoll: boolean): Promise<void> {
    this.shakeLevel = 0;
    const items: ThrowAnim["items"] = [];
    this.dice.forEach((d, i) => {
      const animate = firstRoll || !keep[i];
      const wasInCup = d.inCup;
      d.inCup = false;
      if (!animate) {
        d.mesh.position.copy(d.spot);
        d.mesh.position.y = DIE / 2 + 0.18; // 킵된 건 살짝 띄움
        return;
      }
      // 컵 안에 있던 주사위는 그 자리에서, 아니면 컵 입구에서 쏟아진다.
      const from = wasInCup
        ? d.mesh.position.clone()
        : new THREE.Vector3(this.cupBase.x + (Math.random() - 0.5) * 0.6, this.cupBase.y + 1.4, this.cupBase.z);
      items.push({
        die: d,
        from,
        to: d.spot.clone(),
        value: values[i] || 1,
        yaw: (Math.random() - 0.5) * 0.8,
        spin: new THREE.Vector3(8 + Math.random() * 10, 6 + Math.random() * 8, 8 + Math.random() * 10),
      });
      d.mesh.position.copy(from);
    });
    return new Promise((resolve) => {
      if (items.length === 0) {
        resolve();
        return;
      }
      // 컵은 주사위 줄 쪽으로 기울여 쏟는다.
      this.throwYaw = Math.atan2(SPOTS_X - this.cupBase.x, SPOTS_Z - this.cupBase.z);
      this.cupSpin = this.throwYaw;
      this.throwAnim = { items, t: 0, dur: 1.0, onDone: resolve };
    });
  }

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.update(this.clock.getDelta());
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private update(dt: number) {
    const t = this.clock.elapsedTime;
    // ① 컵 목표 위치: 잡고 있으면 포인터를 따라 들어 올리고, 아니면 제자리로(주사위 위를 넘어서) 돌아온다.
    const sdt = Math.max(dt, 1e-3);
    if (this.held) {
      this.cupTarget.y = 1.5;
    } else if (!this.throwAnim) {
      const far = Math.hypot(this.cupBase.x - CUP.x, this.cupBase.z - CUP.z);
      this.cupTarget.set(CUP.x, far > 0.35 ? 1.3 : 0, CUP.z);
    }
    if (!this.throwAnim) {
      const prev = this.tmp.copy(this.cupBase);
      const follow = 1 - Math.exp(-dt * (this.held ? 16 : 7));
      this.cupBase.lerp(this.cupTarget, follow);
      const v = prev.subVectors(this.cupBase, prev).divideScalar(sdt);
      this.cupVel.lerp(v, 0.35);
    } else {
      this.cupVel.multiplyScalar(0.8);
    }

    // ② 흔들기: 움직이는 속도가 곧 흔들림 세기. 움직인 만큼 컵이 돌아 안의 주사위가 소용돌이친다.
    const speed = Math.hypot(this.cupVel.x, this.cupVel.z);
    if (this.held) {
      this.setShake(Math.min(1, speed / 9));
      this.cupSpin += speed * dt * 0.45;
    }
    const a = this.shakeLevel;
    this.shakeLevel = Math.max(0, this.shakeLevel - dt * 1.8);
    this.cup.position.set(
      this.cupBase.x + Math.sin(t * 40) * 0.12 * a,
      this.cupBase.y + Math.abs(Math.sin(t * 31)) * 0.1 * a,
      this.cupBase.z + Math.cos(t * 33) * 0.1 * a,
    );

    // ③ 기울기: 움직이는 방향으로 입구가 기운다(컵 좌표계 기준).
    if (!this.throwAnim) {
      const cy = Math.cos(this.cupSpin), sy = Math.sin(this.cupSpin);
      const lx = this.cupVel.x * cy - this.cupVel.z * sy;
      const lz = this.cupVel.x * sy + this.cupVel.z * cy;
      const clamp = (v: number) => Math.max(-0.4, Math.min(0.4, v));
      this.cup.rotation.set(
        clamp(lz * 0.04) + Math.cos(t * 38) * 0.1 * a,
        this.cupSpin,
        clamp(-lx * 0.04) + Math.sin(t * 46) * 0.12 * a,
      );
    }

    // 컵 안 주사위: 컵을 따라 움직이고, 흔들면 달그락거린다.
    if (!this.throwAnim) {
      const sh = this.shakeLevel;
      for (const d of this.dice) {
        if (!d.inCup) continue;
        const jx = Math.sin(t * 38 + d.rPhase) * 0.07 * sh;
        const jy = Math.abs(Math.sin(t * 30 + d.rPhase)) * 0.16 * sh;
        const jz = Math.cos(t * 34 + d.rPhase * 1.3) * 0.07 * sh;
        // 컵이 기울어도 주사위가 컵을 따라가도록 컵 좌표계에서 월드로 변환.
        this.tmp.set(d.cupOff.x + jx, d.cupOff.y + jy, d.cupOff.z + jz);
        this.cup.updateMatrixWorld();
        d.mesh.position.copy(this.tmp.applyMatrix4(this.cup.matrixWorld));
        if (sh > 0.02) {
          d.mesh.rotation.x += (4 + d.rPhase) * sh * dt;
          d.mesh.rotation.z += (3 + d.rPhase * 0.7) * sh * dt;
        }
      }
    }

    if (this.throwAnim) {
      const ta = this.throwAnim;
      ta.t += dt;
      const k = Math.min(1, ta.t / ta.dur);
      // 컵을 주사위 쪽으로 엎었다가(앞 절반) 다시 세운다(뒤 절반).
      const tip = k < 0.5 ? Math.sin((k / 0.5) * Math.PI * 0.5) : Math.cos(((k - 0.5) / 0.5) * Math.PI * 0.5);
      this.cup.rotation.set(tip * 1.25, this.throwYaw, 0);
      for (const it of ta.items) {
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const pos = it.from.clone().lerp(it.to, e);
        pos.y += Math.sin(k * Math.PI) * 2.2; // 포물선
        it.die.mesh.position.copy(pos);
        if (k < 0.86) {
          it.die.mesh.rotation.x += it.spin.x * dt;
          it.die.mesh.rotation.y += it.spin.y * dt;
          it.die.mesh.rotation.z += it.spin.z * dt;
        } else {
          this.setTop(it.die.mesh, it.value, it.yaw); // 안착: 눈 맞춤
          it.die.mesh.position.copy(it.to);
        }
      }
      if (k >= 1) {
        this.cup.rotation.set(0, this.throwYaw, 0);
        const done = ta.onDone;
        this.throwAnim = null;
        done();
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

// 주사위 면 텍스처(흰 바탕 + 검은 점).
const pipCache = new Map<number, THREE.CanvasTexture>();
function pipTexture(value: number): THREE.CanvasTexture {
  const cached = pipCache.get(value);
  if (cached) return cached;
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  // 면 전체를 채운다(모서리를 투명하게 두면 검게 보임). 가장자리만 살짝 어둡게.
  const grad = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
  grad.addColorStop(0, "#f7f2e9");
  grad.addColorStop(1, "#e4ddd0");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const lo = S * 0.27,
    mid = S * 0.5,
    hi = S * 0.73,
    r = S * 0.085;
  const layouts: Record<number, [number, number][]> = {
    1: [[mid, mid]],
    2: [[lo, lo], [hi, hi]],
    3: [[lo, lo], [mid, mid], [hi, hi]],
    4: [[lo, lo], [hi, lo], [lo, hi], [hi, hi]],
    5: [[lo, lo], [hi, lo], [mid, mid], [lo, hi], [hi, hi]],
    6: [[lo, lo], [hi, lo], [lo, mid], [hi, mid], [lo, hi], [hi, hi]],
  };
  ctx.fillStyle = value === 1 ? "#cc3333" : "#222";
  for (const [x, y] of layouts[value] ?? []) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  pipCache.set(value, tex);
  return tex;
}
