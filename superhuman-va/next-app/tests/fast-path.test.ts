/**
 * tests/fast-path.test.ts — small talk regex matches /^(hi|hey|...)$/i.
 * The route uses the same regex; this test pins the set.
 */

const SMALL_TALK = /^(hi|hey|hello|yo|thanks|thank you|ok|okay|lol|bye|goodbye|good morning|good night|sup|hola)[\s!.]*$/i;

const shouldMatch = ["hi", "Hey!", "hello.", "thanks", "Thank you", "ok", "okay!", "lol.", "bye", "good morning", "good night", "sup", "hola"];
const shouldNotMatch = ["hi there", "hello world", "tell me about postgres", "good morning to you", ""];

describe("fast-path small talk regex", () => {
  for (const s of shouldMatch) {
    it(`matches: "${s}"`, () => {
      expect(SMALL_TALK.test(s)).toBe(true);
    });
  }
  for (const s of shouldNotMatch) {
    it(`does not match: "${s}"`, () => {
      expect(SMALL_TALK.test(s)).toBe(false);
    });
  }
});
