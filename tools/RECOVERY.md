# Offline escrow recovery

Download the recovery package from the verified escrow screen while the site is available. Save a current copy after any trade-state change. It contains public keys, payout addresses, witness script, amounts, network, contract index and platform public pins. Keep the mnemonic separately. Independently preserve the platform xpub and fee address: values inside a supplied JSON file alone are not a trusted source.

Install the locked backend and frontend dependencies on a trusted machine before disconnecting. Obtain current unspent outputs and their raw parent transactions independently. JSON input format:

```json
[{"txid":"64-character transaction id","vout":0,"value":"base-unit integer","rawTxHex":"raw parent transaction hex"}]
```

From the project root:

```sh
node tools/recover-escrow.cjs build bundle.json utxos.json release 5 unsigned.psbt
node tools/recover-escrow.cjs inspect bundle.json unsigned.psbt release
node tools/recover-escrow.cjs sign bundle.json unsigned.psbt release seller.psbt
node tools/recover-escrow.cjs sign bundle.json unsigned.psbt release buyer.psbt
node tools/recover-escrow.cjs combine bundle.json seller.psbt buyer.psbt release final.hex
```

Each participant signs on their own trusted machine. The sign command prompts for a hidden mnemonic in an interactive terminal; do not pass one as an argument, environment variable or file. Replace `release` with `refund` for the corresponding outcome. Rate is satoshis per virtual byte, or litoshis per virtual byte for LTC. Choose it from current network conditions; 5 is an example.

Inspect every recipient and amount independently before signing. A disputed refund includes the configured fee; a mutual refund does not. The exported trade state is a snapshot, not a live assertion. Confirm the intended outcome and fee policy with the counterparty. The tool cannot determine whether another signed transaction already exists, whether an output is still unspent or whether an external dispute is legitimate.

The CLI produces a signed raw transaction but never broadcasts it. Verify and broadcast separately using the correct network. A user phrase derives only that user's key. Recovery needs two of the three escrow keys; it cannot bypass an unavailable counterparty and unavailable arbitrator. Direct hardware signing is not implemented here. JavaScript cannot guarantee erasure of every mnemonic copy from memory.
