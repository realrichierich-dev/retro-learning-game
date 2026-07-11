import Phaser from "phaser";

const COLORS = {
  bg: 0x1a0f1a,
  panel: 0x2d1b2d,
  border: 0x7ee787,
  bossBorder: 0xffd580,
  hpGood: 0x7ee787,
  hpBad: 0xff7b72,
};

/**
 * Handles both regular wild encounters and boss fights through the same
 * mechanism: a sequence of one or more concept questions, resolved one
 * at a time. A regular encounter is usually a sequence of 1-3 concepts
 * (interleaved practice -- see OverworldScene.startEncounter); a boss
 * fight is a longer sequence covering every concept currently "in
 * rotation." The only real differences are cosmetic (border color, a
 * BOSS banner) and how the HP bar behaves -- per-turn for a regular
 * encounter (each concept is its own full HP bar), one continuous bar
 * that whittles down across the whole fight for a boss.
 */
export default class BattleScene extends Phaser.Scene {
  constructor() {
    super("BattleScene");
  }

  init(data) {
    this.concepts = data.concepts;
    this.isBoss = !!data.isBoss;
    this.onResult = data.onResult;
    this.turnIndex = 0;
    this.results = [];
    this.resolved = false;
  }

  create() {
    const borderColor = this.isBoss ? COLORS.bossBorder : COLORS.border;

    this.add.rectangle(320, 180, 640, 360, COLORS.bg);

    if (this.isBoss) {
      this.add
        .text(320, 8, "BOSS BATTLE", { fontFamily: "monospace", fontSize: "11px", color: "#ffd580" })
        .setOrigin(0.5);
    }

    this.turnLabel = this.add
      .text(600, 8, "", { fontFamily: "monospace", fontSize: "10px", color: "#8b949e" })
      .setOrigin(1, 0);

    // monster panel (top strip, kept compact since the question box below needs
    // most of the vertical space for full-sentence answer options)
    this.panelBorder = this.add.rectangle(460, 65, 280, 100, COLORS.panel).setStrokeStyle(2, borderColor);
    this.titleText = this.add
      .text(460, 25, "", { fontFamily: "monospace", fontSize: "13px", color: "#f0f6fc" })
      .setOrigin(0.5);

    this.monsterImage = this.add.image(460, 65).setScale(this.isBoss ? 3.2 : 2.2);

    this.hpBarBg = this.add.rectangle(460, 100, 160, 8, 0x0f0f1a).setStrokeStyle(1, 0xffffff);
    this.hpBar = this.add.rectangle(460 - 80, 100, 160, 8, COLORS.hpGood).setOrigin(0, 0.5);
    this.correctSoFar = 0;

    // dialogue / question box -- tall, since generated answers are full sentences
    this.boxX = 30;
    this.boxWidth = 580;
    this.textBox = this.add.rectangle(320, 250, 610, 195, COLORS.panel).setStrokeStyle(2, borderColor);
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

    this.startTurn();
  }

  get currentConcept() {
    return this.concepts[this.turnIndex];
  }

  startTurn() {
    if (this.turnIndex >= this.concepts.length) {
      this.finish();
      return;
    }

    this.phase = "dialogue";
    this.resultText.setText("").setColor("#f0f6fc");
    this.optionTexts.forEach((label) => label.destroy());
    this.optionTexts = [];

    const concept = this.currentConcept;
    this.titleText.setText(concept.title.toUpperCase());
    this.turnLabel.setText(this.concepts.length > 1 ? `${this.turnIndex + 1} / ${this.concepts.length}` : "");

    const colorIndex = concept.tags?.length ? concept.tags[0].length % 6 : 0;
    const monsterKey = `monster${colorIndex}`;
    if (this.textures.exists(monsterKey)) this.monsterImage.setTexture(monsterKey);

    this.tweens.killTweensOf(this.hpBar);
    if (!this.isBoss) {
      this.hpBar.setScale(1, 1).setFillStyle(COLORS.hpGood);
    }

    this.showDialogue();
  }

  showDialogue() {
    const concept = this.currentConcept;
    this.dialogueText.setText(concept.dialogue + "\n\n(press SPACE or click to continue)");
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
    const q = this.currentConcept.question;
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

    const concept = this.currentConcept;
    const q = concept.question;
    const won = index === q.correct_index;
    this.results.push({ conceptId: concept.concept_id, won });

    this.optionTexts.forEach((label, i) => {
      if (i === q.correct_index) label.setColor("#7ee787");
      if (i === index && !won) label.setColor("#ff7b72");
      label.disableInteractive();
    });

    // Kill any in-flight tween on the HP bar first -- without this, answering
    // two turns in quick succession stacks a second tween on top of one
    // that hasn't finished, and Phaser blends between the two targets
    // instead of cleanly jumping to the latest one, making the bar crawl
    // toward the wrong value.
    this.tweens.killTweensOf(this.hpBar);

    if (this.isBoss) {
      if (won) {
        this.correctSoFar += 1;
        const remaining = 1 - this.correctSoFar / this.concepts.length;
        this.tweens.add({ targets: this.hpBar, scaleX: remaining, duration: 400 });
        this.resultText.setText("A solid hit!").setColor("#7ee787");
      } else {
        this.cameras.main.shake(150, 0.01);
        this.resultText.setText("The boss shrugs it off -- the correct answer is highlighted.").setColor("#ff7b72");
      }
    } else if (won) {
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

    this.time.delayedCall(1800, () => {
      this.turnIndex += 1;
      this.startTurn();
    });
  }

  finish() {
    if (this.resolved) return;
    this.resolved = true;

    if (this.isBoss) {
      const won = this.correctSoFar === this.concepts.length;
      const summary = won
        ? "Boss defeated! Every concept answered correctly."
        : `Boss battle over: ${this.correctSoFar}/${this.concepts.length} correct. Come back once you've reviewed more.`;
      this.dialogueText.setText(summary);
      this.optionTexts.forEach((label) => label.destroy());
      this.optionTexts = [];
      this.time.delayedCall(2200, () => this.onResult(this.results));
    } else {
      this.onResult(this.results);
    }
  }
}
