import Phaser from "phaser";
import { saveDefeated } from "./BootScene.js";

const WORLD_W = 640;
const WORLD_H = 360;
const PLAYER_SPEED = 120;

// Tag -> retro accent color, cycled if there are more tags than colors.
const MONSTER_COLORS = [0xf78166, 0x58a6ff, 0x7ee787, 0xd2a8ff, 0xffa657, 0xff7b72];

export default class OverworldScene extends Phaser.Scene {
  constructor() {
    super("OverworldScene");
  }

  create() {
    this.encounterActive = false;

    this.drawBackground();

    this.playerTexture();
    this.monsterTexture();

    this.player = this.physics.add.sprite(320, 300, "player");
    this.player.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys("W,A,S,D");

    this.monsterGroup = this.physics.add.group();
    this.spawnMonsters();

    this.physics.add.overlap(this.player, this.monsterGroup, (player, monster) => {
      this.startEncounter(monster);
    });

    this.hud = this.add
      .text(8, 8, "", { fontFamily: "monospace", fontSize: "12px", color: "#f0f6fc" })
      .setDepth(10);
    this.updateHud();

    this.add
      .text(320, 344, "Arrow keys / WASD to move. Walk into a monster to battle.", {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#8b949e",
      })
      .setOrigin(0.5)
      .setDepth(10);
  }

  drawBackground() {
    const g = this.add.graphics();
    g.fillStyle(0x142418, 1);
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.lineStyle(1, 0x1f3326, 1);
    for (let x = 0; x < WORLD_W; x += 32) g.lineBetween(x, 0, x, WORLD_H);
    for (let y = 0; y < WORLD_H; y += 32) g.lineBetween(0, y, WORLD_W, y);
  }

  playerTexture() {
    if (this.textures.exists("player")) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xf0f6fc, 1);
    g.fillRect(0, 0, 16, 16);
    g.fillStyle(0x0f0f1a, 1);
    g.fillRect(4, 4, 3, 3);
    g.fillRect(9, 4, 3, 3);
    g.generateTexture("player", 16, 16);
  }

  monsterTexture() {
    MONSTER_COLORS.forEach((color, i) => {
      const key = `monster${i}`;
      if (this.textures.exists(key)) return;
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(color, 1);
      g.fillRoundedRect(0, 0, 20, 20, 4);
      g.fillStyle(0x0f0f1a, 1);
      g.fillCircle(6, 8, 2);
      g.fillCircle(14, 8, 2);
      g.generateTexture(key, 20, 20);
    });
  }

  spawnMonsters() {
    const concepts = this.registry.get("concepts");
    const defeated = this.registry.get("defeated");
    const alive = concepts.filter((c) => !defeated.has(c.concept_id));

    const cols = 3;
    const marginX = 90;
    const marginY = 70;
    const spacingX = (WORLD_W - marginX * 2) / Math.max(cols - 1, 1);
    const spacingY = 50;

    alive.forEach((concept, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = marginX + col * spacingX;
      const y = marginY + row * spacingY;
      const colorIndex = concept.tags?.length ? concept.tags[0].length % MONSTER_COLORS.length : i % MONSTER_COLORS.length;

      const monster = this.monsterGroup.create(x, y, `monster${colorIndex}`);
      monster.setImmovable(true);
      monster.body.setSize(20, 20);
      monster.concept = concept;

      this.add
        .text(x, y - 16, concept.title, {
          fontFamily: "monospace",
          fontSize: "9px",
          color: "#c9d1d9",
        })
        .setOrigin(0.5)
        .setDepth(5);
    });

    if (alive.length === 0) {
      this.add
        .text(320, 180, "All concepts cleared!\nGreat work.", {
          fontFamily: "monospace",
          fontSize: "16px",
          color: "#7ee787",
          align: "center",
        })
        .setOrigin(0.5);
    }
  }

  updateHud() {
    const hp = this.registry.get("playerHP");
    const maxHp = this.registry.get("playerMaxHP");
    const hearts = "♥".repeat(hp) + "♡".repeat(maxHp - hp);
    const remaining = this.registry.get("concepts").length - this.registry.get("defeated").size;
    this.hud.setText(`HP: ${hearts}   Concepts remaining: ${remaining}`);
  }

  startEncounter(monster) {
    if (this.encounterActive) return;
    this.encounterActive = true;
    this.player.setVelocity(0, 0);

    this.scene.launch("BattleScene", {
      concept: monster.concept,
      onResult: (won) => {
        if (won) {
          this.registry.get("defeated").add(monster.concept.concept_id);
          saveDefeated(this);
          monster.destroy();
        } else {
          const hp = Math.max(0, this.registry.get("playerHP") - 1);
          this.registry.set("playerHP", hp === 0 ? this.registry.get("playerMaxHP") : hp);
        }
        this.updateHud();
        this.encounterActive = false;
        this.scene.stop("BattleScene");
        this.scene.resume();
      },
    });
    this.scene.pause();
  }

  update() {
    if (this.encounterActive) return;
    const speed = PLAYER_SPEED;
    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown || this.wasd.A.isDown) vx = -speed;
    else if (this.cursors.right.isDown || this.wasd.D.isDown) vx = speed;

    if (this.cursors.up.isDown || this.wasd.W.isDown) vy = -speed;
    else if (this.cursors.down.isDown || this.wasd.S.isDown) vy = speed;

    this.player.setVelocity(vx, vy);
  }
}
