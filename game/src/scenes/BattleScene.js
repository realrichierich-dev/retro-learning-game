import Phaser from "phaser";

const COLORS = {
  bg: 0x1a0f1a,
  panel: 0x2d1b2d,
  border: 0x7ee787,
  hpGood: 0x7ee787,
  hpBad: 0xff7b72,
  correct: 0x7ee787,
  wrong: 0xff7b72,
};

export default class BattleScene extends Phaser.Scene {
  constructor() {
    super("BattleScene");
  }

  init(data) {
    this.concept = data.concept;
    this.onResult = data.onResult;
    this.resolved = false;
  }

  create() {
    this.monsterHP = 1; // one correct hit defeats the monster -- simplest possible turn loop
    this.phase = "dialogue"; // dialogue -> question -> resolved

    this.add.rectangle(320, 180, 640, 360, COLORS.bg);

    // monster panel (top strip, kept compact since the question box below needs
    // most of the vertical space for full-sentence answer options)
    this.add.rectangle(460, 65, 280, 100, COLORS.panel).setStrokeStyle(2, COLORS.border);
    this.add
      .text(460, 25, this.concept.title.toUpperCase(), {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#f0f6fc",
      })
      .setOrigin(0.5);

    const colorIndex = this.concept.tags?.length ? this.concept.tags[0].length % 6 : 0;
    const monsterKey = `monster${colorIndex}`;
    if (this.textures.exists(monsterKey)) {
      this.add.image(460, 65).setTexture(monsterKey).setScale(2.2);
    }

    this.hpBarBg = this.add.rectangle(460, 100, 160, 8, 0x0f0f1a).setStrokeStyle(1, 0xffffff);
    this.hpBar = this.add.rectangle(460 - 80, 100, 160, 8, COLORS.hpGood).setOrigin(0, 0.5);

    // dialogue / question box -- tall, since generated answers are full sentences
    this.boxX = 30;
    this.boxWidth = 580;
    this.textBox = this.add.rectangle(320, 250, 610, 195, COLORS.panel).setStrokeStyle(2, COLORS.border);
    this.dialogueText = this.add
      .text(this.boxX, 162, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#f0f6fc",
        wordWrap: { width: this.boxWidth },
        lineSpacing: 4,
      })
      .setOrigin(0, 0);

    this.optionTexts = [];

    // short result banner shown in the gap between the monster panel and the
    // question box, so it never has to fight the option list for space
    this.resultText = this.add
      .text(320, 133, "", { fontFamily: "monospace", fontSize: "12px", color: "#f0f6fc" })
      .setOrigin(0.5);

    this.showDialogue();
  }

  showDialogue() {
    this.dialogueText.setText(this.concept.dialogue + "\n\n(press SPACE or click to continue)");
    const advance = () => {
      this.input.keyboard.off("keydown-SPACE", advance);
      this.showQuestion();
    };
    this.input.keyboard.once("keydown-SPACE", advance);
    this.textBox.setInteractive({ useHandCursor: true }).once("pointerdown", () => {
      this.input.keyboard.off("keydown-SPACE", advance);
      this.showQuestion();
    });
  }

  showQuestion() {
    this.phase = "question";
    this.textBox.disableInteractive();
    const q = this.concept.question;
    this.dialogueText.setText(q.prompt);

    // Options are full sentences (verbatim quotes from the source slide), so
    // they're stacked as a single left-aligned, word-wrapped list rather than
    // a short-answer grid -- each row's height is measured so the next row
    // never overlaps it.
    let y = this.dialogueText.y + this.dialogueText.height + 10;

    q.options.forEach((option, i) => {
      const label = this.add
        .text(this.boxX, y, `${i + 1}. ${option}`, {
          fontFamily: "monospace",
          fontSize: "11px",
          color: "#c9d1d9",
          wordWrap: { width: this.boxWidth },
          lineSpacing: 2,
        })
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });

      label.on("pointerover", () => label.setColor("#ffffff"));
      label.on("pointerout", () => label.setColor("#c9d1d9"));
      label.on("pointerdown", () => this.chooseOption(i));

      this.optionTexts.push(label);
      y += label.height + 6;
    });

    ["ONE", "TWO", "THREE", "FOUR"].slice(0, q.options.length).forEach((code, i) => {
      this.input.keyboard.on(`keydown-${code}`, () => this.chooseOption(i));
    });
  }

  chooseOption(index) {
    if (this.phase !== "question") return;
    this.phase = "resolved";
    ["ONE", "TWO", "THREE", "FOUR"].forEach((code) => this.input.keyboard.off(`keydown-${code}`));

    const q = this.concept.question;
    const won = index === q.correct_index;

    this.optionTexts.forEach((label, i) => {
      if (i === q.correct_index) label.setColor("#7ee787");
      if (i === index && !won) label.setColor("#ff7b72");
      label.disableInteractive();
    });

    if (won) {
      this.tweens.add({
        targets: this.hpBar,
        scaleX: 0,
        duration: 400,
        onComplete: () => {
          this.resultText.setText("Correct! Critical hit! The monster is defeated!").setColor("#7ee787");
        },
      });
    } else {
      this.hpBar.setFillStyle(COLORS.hpBad);
      this.cameras.main.shake(150, 0.01);
      this.resultText.setText("Not quite -- the correct answer is highlighted. The monster strikes back!").setColor("#ff7b72");
    }

    this.time.delayedCall(1800, () => this.finish(won));
  }

  finish(won) {
    if (this.resolved) return;
    this.resolved = true;
    this.onResult(won);
  }
}
