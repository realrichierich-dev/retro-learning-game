import Phaser from "phaser";
import concepts from "../data/concepts.json";

const DEFEATED_KEY = "retro-learning-game:defeated";

export default class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  create() {
    this.registry.set("concepts", concepts.concepts);
    this.registry.set("playerHP", 3);
    this.registry.set("playerMaxHP", 3);

    let defeated = [];
    try {
      defeated = JSON.parse(localStorage.getItem(DEFEATED_KEY) || "[]");
    } catch (e) {
      defeated = [];
    }
    this.registry.set("defeated", new Set(defeated));

    this.add
      .text(320, 150, "RETRO LEARNING GAME", {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#7ee787",
      })
      .setOrigin(0.5);
    this.add
      .text(320, 190, `Loaded ${concepts.concepts.length} concepts from "${concepts.source_deck}"`, {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#8b949e",
      })
      .setOrigin(0.5);
    this.add
      .text(320, 220, "Press SPACE to start", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#f0f6fc",
      })
      .setOrigin(0.5);

    this.input.keyboard.once("keydown-SPACE", () => this.scene.start("OverworldScene"));
    this.input.once("pointerdown", () => this.scene.start("OverworldScene"));
  }
}

export function saveDefeated(scene) {
  const defeated = scene.registry.get("defeated");
  localStorage.setItem(DEFEATED_KEY, JSON.stringify([...defeated]));
}
