// Always-false validator. The five verification keys and the reference scripts are
// parked at the address derived from this program, so they can be read as
// reference inputs but never spent (see packages/protocol/test/park.test.mjs).
validator always_false {
  else(_ctx: Data) {
    False
  }
}
