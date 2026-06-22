// 요트 3D 씬: 주사위 5개 + 컵. 컵을 드래그로 흔들고(연출), 놓으면 주사위가 판 위로
// 쏟아져 텀블 후 서버/엔진이 정한 눈으로 안착. 킵된 주사위는 제자리, 리롤만 다시 던진다.

import * as THREE from "three";

const DIE = 0.92; // 주사위 한 변
const SPOTS_Z = 1.4; // 주사위가 놓이는 줄의 z
const CUP = { x: 0, y: 0, z: 5.2 }; // 컵 위치(앞쪽)

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

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x12111a, 14, 30);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    this.camera.position.set(0, 8.5, 9.5);
    this.camera.lookAt(0, 0, 1.2);

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
    key.shadow.bias = -0.0005;
    this.scene.add(key);
  }

  private buildTable() {
    const felt = new THREE.Mesh(
      new THREE.BoxGeometry(14, 0.4, 13),
      new THREE.MeshStandardMaterial({ color: 0x1f6b46, roughness: 0.95 }),
    );
    felt.position.set(0, -0.2, 1.5);
    felt.receiveShadow = true;
    this.scene.add(felt);
    // 가장자리 테두리.
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(14.6, 0.7, 13.6),
      new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.8 }),
    );
    rim.position.set(0, -0.35, 1.5);
    rim.receiveShadow = true;
    this.scene.add(rim);
  }

  private buildCup(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a3b2a, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
    const side = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.85, 2.0, 28, 1, true), mat);
    side.position.y = 1.0;
    side.castShadow = true;
    g.add(side);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.85, 28), mat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 0.02;
    g.add(bottom);
    g.position.set(CUP.x, 0, CUP.z);
    return g;
  }

  private buildDice() {
    const mats = [2, 5, 1, 6, 3, 4].map(
      (v) => new THREE.MeshStandardMaterial({ map: pipTexture(v), roughness: 0.4 }),
    );
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(DIE, DIE, DIE), mats.map((m) => m.clone()));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const spot = new THREE.Vector3((i - 2) * 1.25, DIE / 2, SPOTS_Z);
      mesh.position.copy(spot);
      this.setTop(mesh, 1, 0);
      this.scene.add(mesh);
      this.dice.push({ mesh, spot, inCup: false, cupOff: new THREE.Vector3(), rPhase: i * 1.7 });
    }
  }

  // 컵 내부 무작위 위치(컵 원점 기준).
  private randCupOff(): THREE.Vector3 {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * 0.4;
    return new THREE.Vector3(Math.cos(ang) * rad, 0.55 + Math.random() * 0.5, 0.2 + Math.sin(ang) * rad);
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
    this.dice.forEach((d, i) => {
      if (firstRoll || !keep[i]) {
        d.inCup = true;
        d.cupOff = this.randCupOff();
        this.setTop(d.mesh, values[i] || 1, Math.random() * Math.PI);
      } else {
        d.inCup = false;
        d.mesh.position.copy(d.spot);
        d.mesh.position.y = DIE / 2 + 0.18;
        this.setTop(d.mesh, values[i] || 1, 0);
      }
    });
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
        : new THREE.Vector3(CUP.x + (Math.random() - 0.5) * 0.6, 1.4, CUP.z);
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
    // 컵 흔들기(드래그 세기에 비례한 지터). shakeLevel은 서서히 감쇠.
    if (this.shakeLevel > 0.001) {
      const a = this.shakeLevel;
      this.cup.position.x = CUP.x + Math.sin(t * 40) * 0.35 * a;
      this.cup.position.z = CUP.z + Math.cos(t * 33) * 0.25 * a;
      this.cup.rotation.z = Math.sin(t * 46) * 0.25 * a;
      this.cup.rotation.x = Math.cos(t * 38) * 0.18 * a;
      this.shakeLevel = Math.max(0, this.shakeLevel - dt * 1.8);
    } else {
      this.cup.position.set(CUP.x, 0, CUP.z);
      this.cup.rotation.set(0, 0, 0);
    }

    // 컵 안 주사위: 컵을 따라 움직이고, 흔들면 달그락거린다.
    if (!this.throwAnim) {
      const sh = this.shakeLevel;
      for (const d of this.dice) {
        if (!d.inCup) continue;
        const jx = Math.sin(t * 38 + d.rPhase) * 0.18 * sh;
        const jy = Math.abs(Math.sin(t * 30 + d.rPhase)) * 0.22 * sh;
        const jz = Math.cos(t * 34 + d.rPhase * 1.3) * 0.16 * sh;
        d.mesh.position.set(
          this.cup.position.x + d.cupOff.x + jx,
          this.cup.position.y + d.cupOff.y + jy,
          this.cup.position.z + d.cupOff.z + jz,
        );
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
      // 컵을 살짝 엎는 연출.
      this.cup.rotation.x = -Math.min(1, k * 2) * 0.9;
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
        this.cup.rotation.set(0, 0, 0);
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
  const S = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#f4efe6";
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(4, 4, S - 8, S - 8, 22);
    ctx.fill();
  } else {
    ctx.fillRect(4, 4, S - 8, S - 8);
  }
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
  pipCache.set(value, tex);
  return tex;
}
