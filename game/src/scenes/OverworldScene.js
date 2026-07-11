import Phaser from "phaser";
import { getDueConceptIds, gradeConcept, earliestDue, formatTimeUntil } from "../scheduler.js";

const WORLD_W = 640;
const WORLD_H = 360;
const PLAYER_SPEED = 120;
const BOSS_UNLOCK_REPS = 3; // concepts need this many reviews "in rotation" before the boss appears
const MAX_INTERLEAVED_CONCEPTS = 3; // how many due concepts one wild encounter pulls in at once

// Tag -> retro accent color, cycled if there are more tags than colors.
const MONSTER_COLORS = [0xf78166, 0x58a6ff, 0x7ee787, 0xd2a8ff, 0xffa657, 0xff7b72];

export default class OverworldScene extends Phaser.Scene {
  constructor() {
    super("OverworldScene");
  }

  create() {
    this.encounterActive = false;
    this.encounterActorPos = null;

    this.drawBackground();

    this.playerTexture();
    this.monsterTexture();
    this.bossTexture();

    this.player = this.physics.add.sprite(320, 300, "player");
    this.player.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys("W,A,S,D");

    this.monsterGroup = this.physics.add.group();
    this.bossGroup = this.physics.add.group();
    this.monsterLabels = [];
    this.refreshMonsters();

    this.physics.add.overlap(this.player, this.monsterGroup, (player, monster) => {
      this.startEncounter(monster);
    });
    this.physics.add.overlap(this.player, this.bossGroup, (player, boss) => {
      this.startBossEncounter(boss);
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

    // small scattered "grass tuft" decorations, deterministic per grid cell
    // so the ground has some texture without needing any downloaded art
    g.fillStyle(0x1f3326, 1);
    for (let gx = 16; gx < WORLD_W; gx += 32) {
      for (let gy = 16; gy < WORLD_H; gy += 32) {
        if ((gx * 7 + gy * 13) % 32 < 5) {
          g.fillRect(gx - 1, gy - 1, 2, 2);
          g.fillRect(gx + 3, gy + 2, 2, 2);
        }
      }
    }
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
    // Each color also gets a distinct body shape, cycling through three
    // silhouettes, so monsters read as different "species" rather than
    // just recolors of the same square.
    MONSTER_COLORS.forEach((color, i) => {
      const key = `monster${i}`;
      if (this.textures.exists(key)) return;
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(color, 1);

      const shape = i % 3;
      if (shape === 0) {
        g.fillRoundedRect(0, 0, 20, 20, 4);
      } else if (shape === 1) {
        g.fillCircle(10, 10, 10);
      } else {
        g.fillTriangle(10, 0, 20, 18, 0, 18);
      }

      g.fillStyle(0x0f0f1a, 1);
      g.fillCircle(6, shape === 2 ? 12 : 8, 2);
      g.fillCircle(14, shape === 2 ? 12 : 8, 2);
      g.generateTexture(key, 20, 20);
    });
  }

  bossTexture() {
    if (this.textures.exists("boss")) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffd580, 1);
    g.fillRoundedRect(0, 0, 30, 30, 6);
    g.fillStyle(0x1a0f1a, 1);
    g.fillCircle(9, 12, 3);
    g.fillCircle(21, 12, 3);
    g.fillRect(9, 20, 12, 3);
    g.generateTexture("boss", 30, 30);
  }

  /** Concepts that have been reviewed at least once -- "in rotation" per the build plan. */
  conceptsInRotation() {
    const concepts = this.registry.get("concepts");
    const cards = this.registry.get("cards");
    return concepts.filter((c) => cards[c.concept_id].reps > 0);
  }

  /**
   * Clears and redraws every monster/label/boss on the map based on the
   * current FSRS due state. Called on scene create and again after every
   * battle resolves, rather than surgically destroying individual sprites
   * -- simpler and always correct, since due status can change for
   * concepts other than the one the player directly walked into (a wild
   * encounter interleaves a few due concepts together, and a boss fight
   * touches many at once).
   */
  refreshMonsters() {
    this.monsterGroup.clear(true, true);
    this.bossGroup.clear(true, true);
    this.monsterLabels.forEach((label) => label.destroy());
    this.monsterLabels = [];
    if (this.caughtUpText) {
      this.caughtUpText.destroy();
      this.caughtUpText = null;
    }

    const concepts = this.registry.get("concepts");
    const cards = this.registry.get("cards");
    const dueIds = new Set(getDueConceptIds(cards));
    const alive = concepts.filter((c) => dueIds.has(c.concept_id));

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

      // gentle idle bob, staggered per-monster so they don't all move in lockstep
      this.tweens.add({
        targets: monster,
        y: y - 3,
        duration: 650 + (i % 3) * 80,
        delay: i * 120,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });

      this.monsterLabels.push(
        this.add
          .text(x, y - 16, concept.title, { fontFamily: "monospace", fontSize: "9px", color: "#c9d1d9" })
          .setOrigin(0.5)
          .setDepth(5)
      );
    });

    if (this.conceptsInRotation().length >= BOSS_UNLOCK_REPS) {
      const bossX = WORLD_W - 60;
      const bossY = WORLD_H - 60;
      const boss = this.bossGroup.create(bossX, bossY, "boss");
      boss.setImmovable(true);
      boss.body.setSize(30, 30);
      this.tweens.add({
        targets: boss,
        y: bossY - 4,
        duration: 800,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      this.monsterLabels.push(
        this.add
          .text(bossX, bossY - 22, "BOSS", { fontFamily: "monospace", fontSize: "10px", color: "#ffd580" })
          .setOrigin(0.5)
          .setDepth(5)
      );
    }

    if (alive.length === 0) {
      const due = earliestDue(cards);
      const message = due ? `All caught up!\nNext review due in ${formatTimeUntil(due)}.` : "All caught up!";
      this.caughtUpText = this.add
        .text(320, 180, message, { fontFamily: "monospace", fontSize: "16px", color: "#7ee787", align: "center" })
        .setOrigin(0.5);
    }
  }

  updateHud() {
    const hp = this.registry.get("playerHP");
    const maxHp = this.registry.get("playerMaxHP");
    const hearts = "♥".repeat(hp) + "♡".repeat(maxHp - hp);
    const cards = this.registry.get("cards");
    const total = this.registry.get("concepts").length;
    const due = getDueConceptIds(cards).length;
    this.hud.setText(`HP: ${hearts}   Due now: ${due} / ${total}`);
  }

  /** Applies FSRS grading + HP loss for a batch of results, then resyncs the map. */
  applyBattleResults(results) {
    const cards = this.registry.get("cards");
    let hp = this.registry.get("playerHP");
    const maxHp = this.registry.get("playerMaxHP");

    results.forEach(({ conceptId, won }) => {
      gradeConcept(cards, conceptId, won);
      if (!won) hp = Math.max(0, hp - 1);
    });
    this.registry.set("playerHP", hp === 0 ? maxHp : hp);

    this.updateHud();
    this.refreshMonsters();
    this.encounterActive = false;

    // The boss (unlike regular monsters, which get removed by refreshMonsters
    // above whenever their concept is no longer due) isn't removed after a
    // fight, so it's still sitting right where the player is standing. Push
    // the player back away from wherever the encounter started so the
    // overlap doesn't immediately re-fire and launch a second battle before
    // they've had a chance to move away.
    if (this.encounterActorPos) {
      const dx = this.player.x - this.encounterActorPos.x;
      const dy = this.player.y - this.encounterActorPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const pushBack = 40;
      this.player.setPosition(
        Phaser.Math.Clamp(this.encounterActorPos.x + (dx / dist) * pushBack, 8, WORLD_W - 8),
        Phaser.Math.Clamp(this.encounterActorPos.y + (dy / dist) * pushBack, 8, WORLD_H - 8)
      );
    }

    this.scene.stop("BattleScene");
    this.scene.resume();
  }

  startEncounter(monster) {
    if (this.encounterActive) return;
    this.encounterActive = true;
    this.encounterActorPos = { x: monster.x, y: monster.y };
    this.player.setVelocity(0, 0);

    // Interleave 1-2 other currently-due concepts alongside the one the
    // player walked into, rather than always drilling a single concept in
    // isolation -- this is the "interleaved wild encounters" mechanic from
    // the build plan (desirable-difficulty spacing across concepts).
    const concepts = this.registry.get("concepts");
    const cards = this.registry.get("cards");
    const otherDue = getDueConceptIds(cards)
      .filter((id) => id !== monster.concept.concept_id)
      .sort(() => Math.random() - 0.5)
      .slice(0, MAX_INTERLEAVED_CONCEPTS - 1)
      .map((id) => concepts.find((c) => c.concept_id === id));
    const battleConcepts = [monster.concept, ...otherDue];

    this.scene.launch("BattleScene", {
      concepts: battleConcepts,
      isBoss: false,
      onResult: (results) => this.applyBattleResults(results),
    });
    this.scene.pause();
  }

  startBossEncounter(boss) {
    if (this.encounterActive) return;
    this.encounterActive = true;
    this.encounterActorPos = { x: boss.x, y: boss.y };
    this.player.setVelocity(0, 0);

    const battleConcepts = this.conceptsInRotation();

    this.scene.launch("BattleScene", {
      concepts: battleConcepts,
      isBoss: true,
      onResult: (results) => this.applyBattleResults(results),
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
