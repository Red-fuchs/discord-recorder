// hoer: live on-device STT (Apple SpeechAnalyzer). stdin = s16le 48 kHz stereo PCM, stdout = JSON lines {start,end,text,final} (volatile + final results).
// Usage: hoer [locale=de-DE]    build: swiftc -O stt/hoer.swift -o stt/hoer
import AVFoundation
import Foundation
import Speech

let loc = Locale(identifier: CommandLine.arguments.dropFirst().first ?? "de-DE")
let err = FileHandle.standardError

func log(_ s: String) { err.write((s + "\n").data(using: .utf8)!) }

let tr = SpeechTranscriber(locale: loc, transcriptionOptions: [], reportingOptions: [.volatileResults, .fastResults], attributeOptions: [.audioTimeRange])
if let req = try await AssetInventory.assetInstallationRequest(supporting: [tr]) {
  log("hoer: lade Sprachmodell \(loc.identifier)…"); try await req.downloadAndInstall()
}
let src = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 48000, channels: 2, interleaved: true)!
guard let dst = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [tr], considering: src),
      let conv = AVAudioConverter(from: src, to: dst) else { log("hoer: kein Audioformat"); exit(1) }

let (input, cont) = AsyncStream.makeStream(of: AnalyzerInput.self)
let analyzer = SpeechAnalyzer(modules: [tr])

// detached: main thread blocks on stdin, results must not wait for it
let out = Task.detached {
  for try await r in tr.results {
    let text = String(r.text.characters).trimmingCharacters(in: .whitespaces)
    guard !text.isEmpty else { continue }
    let o: [String: Any] = ["start": r.range.start.seconds, "end": r.range.end.seconds, "text": text, "final": r.isFinal]
    print(String(data: try JSONSerialization.data(withJSONObject: o), encoding: .utf8)!); fflush(stdout)
  }
}
try await analyzer.start(inputSequence: input)

// stdin reader: 100 ms chunks → convert → analyzer
let chunk = 48000 / 10 * 4
while true {
  let d = FileHandle.standardInput.readData(ofLength: chunk)
  if d.isEmpty { break }
  let n = AVAudioFrameCount(d.count / 4)
  let b = AVAudioPCMBuffer(pcmFormat: src, frameCapacity: n)!
  b.frameLength = n
  _ = d.withUnsafeBytes { memcpy(b.int16ChannelData![0], $0.baseAddress!, d.count) }
  let o = AVAudioPCMBuffer(pcmFormat: dst, frameCapacity: AVAudioFrameCount(Double(n) * dst.sampleRate / 48000) + 64)!
  var fed = false
  var e: NSError?
  conv.convert(to: o, error: &e) { _, st in
    if fed { st.pointee = .noDataNow; return nil }
    fed = true; st.pointee = .haveData; return b
  }
  if let e { log("hoer: \(e)"); continue }
  cont.yield(AnalyzerInput(buffer: o))
}
cont.finish()
try await analyzer.finalizeAndFinishThroughEndOfInput()
_ = try await out.value
