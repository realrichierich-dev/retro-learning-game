import Phaser from "phaser";
import BootScene from "./scenes/BootScene.js";
import OverworldScene from "./scenes/OverworldScene.js";
import BattleScene from "./scenes/BattleScene.js";

const config = {
  type: Phaser.AUTO,
  parent: "game-container",
  width: 640,
  height: 360,
  pixelArt: true,
  backgroundColor: "#0f0f1a",
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, OverworldScene, BattleScene],
};

window.__game = new Phaser.Game(config);
