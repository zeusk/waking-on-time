'use client';

import type { JSX } from 'react';
import { Frame } from '@/components/ui';
import Code from '@/components/Code';
import LatencyBudget from '@/components/demos/LatencyBudget';
import ReprojectionDemo from '@/components/demos/ReprojectionDemo';
import VsyncTimeline from '@/components/demos/VsyncTimeline';
import FencePipeline from '@/components/demos/FencePipeline';
import SlicerLayer, { LAYER_COLORS } from '@/components/demos/SlicerLayer';
import MatStages from '@/components/demos/MatStages';
import MatToolpaths from '@/components/demos/MatToolpaths';
import VsyncSources from '@/components/demos/VsyncSources';
import PhaseDrift from '@/components/demos/PhaseDrift';

export const TALK_TITLE = 'Waking up on time';

// Speaker notes and timings live in speaker-notes.md, which is kept out of the public deck and repo.
export type SlideDef = {
  id: string;
  Component: (props: { active: boolean }) => JSX.Element;
};

// The compositor's own code (C++/WinRT + D3D12), split into setup and the per-frame loop and re-wrapped to fit.
const COMPOSITOR_SETUP = `
auto interop = device.as<IDisplayDeviceInterop>();
DisplaySource   source = device.CreateScanoutSource(target);
DisplayTaskPool pool   = device.CreateTaskPool();

for (int i = 0; i < kBuffers; ++i) {
    primary[i] = device.CreatePrimary(target, primaryDesc);
    HANDLE h;
    interop->CreateSharedHandle(primary[i].as<IInspectable>().get(),
                                nullptr, GENERIC_ALL, nullptr, &h);
    d3d->OpenSharedHandle(h, IID_PPV_ARGS(rt[i].put()));
    scanout[i] = device.CreateSimpleScanout(source, primary[i], 0,
                                            /*syncInterval*/ 1);
}

// D3D-created fences, wrapped as DisplayFences: renderDone, flipTo, flipAway
// (CreateFence(SHARED) -> CreateSharedHandle -> interop->OpenSharedHandle)
DisplayFence renderDoneDF = WrapD3DFence(renderDone);
DisplayFence flipToDF     = WrapD3DFence(flipTo);
DisplayFence flipAwayDF   = WrapD3DFence(flipAway);

// Display-created periodic fence, exposed to D3D
// (interop->CreateSharedHandle -> d3d->OpenSharedHandle)
DisplayFence tick = device.CreatePeriodicFence(target, offsetFromVblank);
com_ptr<ID3D12Fence> tickD3D = OpenInD3D(tick);
`;

const COMPOSITOR_FRAME = `
queue->Wait(flipAway.get(), lastIdUsing[i]);   // buffer i is off-screen
queue->Wait(tickD3D.get(), k);                 // start at vblank-offset, display-timed
queue->ExecuteCommandLists(1, &warpInto_i);    // shader reads late-latched pose
queue->Signal(renderDone.get(), ++v);

DisplayTask task = pool.CreateTask();
task.SetScanout(scanout[i]);
task.SetWait(renderDoneDF, v);                 // flip gated on GPU completion
task.SetSignal(DisplayTaskSignalKind::OnPresentFlipTo,   flipToDF);
task.SetSignal(DisplayTaskSignalKind::OnPresentFlipAway, flipAwayDF);
DisplayTaskResult r = pool.TryExecuteTask(task);   // returns immediately
lastIdUsing[i] = r.PresentId();
targetRefreshFor[r.PresentId()] = k + 1;
`;

const COMPOSITOR_APIS = [
  'CreateScanoutSource',
  'CreateTaskPool',
  'CreatePrimary',
  'CreateSharedHandle',
  'OpenSharedHandle',
  'CreateSimpleScanout',
  'CreatePeriodicFence',
  'Wait',
  'ExecuteCommandLists',
  'Signal',
  'CreateTask',
  'SetScanout',
  'SetWait',
  'SetSignal',
  'OnPresentFlipTo',
  'OnPresentFlipAway',
  'TryExecuteTask',
  'PresentId',
];

/** Which way each fence in the compositor code points. */
const COMPOSITOR_FENCES: [string, string, string][] = [
  ['tick', 'display → GPU', 'every refresh at vblank − offset: the warp waits for value k'],
  ['renderDone', 'GPU → display', 'when the warp finishes: the flip waits for it'],
  ['flipTo', 'display → app', 'when the present reaches the screen'],
  ['flipAway', 'display → GPU', 'when buffer i leaves the screen: the next warp into it waits'],
];

const DRIVER_CODE = `
// One thread per swapchain, as in the IddCx sample driver
IddCxSwapChainSetDevice(swapChain, &setDevice);
for (;;) {
  IDARG_OUT_RELEASEANDACQUIREBUFFER buf = {};
  HRESULT hr = IddCxSwapChainReleaseAndAcquireBuffer(swapChain, &buf);
  if (hr == E_PENDING) { WaitForNewFrame(); continue; }

  // buf.MetaData.pSurface: frame to encode
  // buf.MetaData.PresentDisplayQPCTime: when it should be on screen
  bool sent = EncodeAndSend(buf.MetaData.pSurface);
  IddCxSwapChainFinishedProcessingFrame(swapChain);

  stats.FrameStatus = sent ? IDDCX_FRAME_STATUS_COMPLETED
                           : IDDCX_FRAME_STATUS_DROPPED;
  IddCxSwapChainReportFrameStatistics(swapChain, &args);
}
`;

const DRIVER_APIS = [
  'IddCxSwapChainSetDevice',
  'IddCxSwapChainReleaseAndAcquireBuffer',
  'IddCxSwapChainFinishedProcessingFrame',
  'IddCxSwapChainReportFrameStatistics',
  'IDDCX_FRAME_STATUS_COMPLETED',
  'IDDCX_FRAME_STATUS_DROPPED',
];

const KERNEL_CODE = `
timer = ExAllocateTimer(OnFenceTimer, ctx,
                        EX_TIMER_HIGH_RESOLUTION);

OnFlip():                                // vsync emulation thread
  dueQpc = PredictVblankQpc(stats) - offsetQpc;  // QPC ticks
  nowQpc = KeQueryPerformanceCounter(&freq);
  delay  = (dueQpc - nowQpc) * 10'000'000 / freq;  // → 100 ns
  ExSetTimer(timer, -delay, 0, NULL);   // high-res: relative only

OnFenceTimer():
  fence.value += 1;
  SignalPeriodicFence(fence);      // compositor wakes up

OnModeChange():
  fence.value = MAX;               // release waiters exactly once
  SignalPeriodicFence(fence);
`;

const KERNEL_APIS = ['ExAllocateTimer', 'EX_TIMER_HIGH_RESOLUTION', 'ExSetTimer', 'KeQueryPerformanceCounter'];

export const slides: SlideDef[] = [
  {
    id: 'title',
    Component: () => (
      <div className="title-slide">
        <svg className="title-ticks" viewBox="0 0 1600 120" preserveAspectRatio="none">
          {Array.from({ length: 12 }, (_, i) => (
            <g key={i}>
              <line x1={80 + i * 130} x2={80 + i * 130} y1={20} y2={110} className="tick" />
              <circle cx={80 + i * 130 - 26} cy={64} r={6} className="tick-wake" style={{ animationDelay: `${i * 0.12}s` }} />
            </g>
          ))}
        </svg>
        <div className="kicker">Onsite presentation</div>
        <h1>Waking up on time</h1>
        <p className="subtitle">
          Periodic notification fences for indirect displays, and why late-stage reprojection depends on them
        </p>
        <div className="byline">Shantanu Gupta</div>
      </div>
    ),
  },
  {
    id: 'about',
    Component: () => (
      <Frame kicker="About me" title="Working where hardware meets software">
        <div className="cols about-cols">
          <div className="about-left">
            <ol className="timeline">
              <li>
                <div className="tl-when">2023 – now</div>
                <div className="tl-where">
                  <b>Apple</b> · Platform Diagnostics, Vision Products Group
                </div>
              </li>
              <li>
                <div className="tl-when">2022 – 2023</div>
                <div className="tl-where">
                  <b>Intel</b> · Microsoft Co-Engineering
                </div>
              </li>
              <li>
                <div className="tl-when">2019 – 2022</div>
                <div className="tl-where">
                  <b>Microsoft</b> · dxgkrnl, Silicon Graphics &amp; Media
                </div>
              </li>
              <li>
                <div className="tl-when">2015 – 2019</div>
                <div className="tl-where">
                  <b>Drexel University</b> · B.Sc. Computer Science
                </div>
              </li>
            </ol>
            <p className="about-tools">
              C · C++ · Python · WinDbg · WPA/xperf · GPUView · PIX · lldb/gdb · IDA Pro
            </p>
          </div>
          <div className="about-side">
            <div className="about-block">
              <div className="card-kicker">Interests</div>
              <div className="chips">
                {[
                  'HW/SW interface',
                  'Firmware & OS',
                  'VR & novel displays',
                  'Domain-specific architectures',
                  'Parallel computation',
                  'Aviation & automotive',
                ].map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="about-block">
              <div className="card-kicker">Internships</div>
              <ul className="about-rows">
                <li>
                  <b>Microsoft</b> <span>Summer 2018</span>
                </li>
                <li>
                  <b>Markforged</b> <span>Spring 2018</span>
                </li>
                <li>
                  <b>Microsoft</b> <span>Summer 2017</span>
                </li>
                <li>
                  <b>Sourcegraph</b> <span>Fall 2016</span>
                </li>
                <li>
                  <b>Palo Alto Networks</b> <span>Summer 2016</span>
                </li>
              </ul>
            </div>
            <div className="about-block">
              <div className="card-kicker">Personal projects</div>
              <ul className="about-rows">
                <li>
                  <b>cLK</b> Homebrew Linux bootloader for Windows Mobile phones, on Little Kernel <span>2012</span>
                </li>
                <li>
                  <b>htc-linux</b> Kernel and Android tree for CyanogenMod on the HTC HD2 <span>2012</span>
                </li>
                <li>
                  <b>Windows for Vision Pro</b> Virtual displays via UIKit, CoreGraphics and IddCx <span>2024</span>
                </li>
                <li>
                  <b>µ-2σ</b> Best Halite II bot at Two Sigma <span>2018</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </Frame>
    ),
  },
  {
    id: 'latency',
    Component: () => (
      <Frame kicker="The problem" title="In a headset, latency feels like nausea">
        <LatencyBudget />
      </Frame>
    ),
  },
  {
    id: 'demo',
    Component: ({ active }) => (
      <Frame kicker="Demo" title="Warp the last frame to the newest head pose">
        <ReprojectionDemo active={active} />
      </Frame>
    ),
  },
  {
    id: 'how',
    Component: () => (
      <Frame kicker="How it works" title="The warp is cheap. Starting it on time is hard.">
        <div className="cols cols-wide-left">
          <ol className="steps">
            <li>App renders a frame using the head pose predicted at render start</li>
            <li>Just before scanout, sample the newest head pose</li>
            <li>Warp the finished image by the rotation since the render pose</li>
            <li>Scan it out. Repeat every refresh, even if the app missed its frame</li>
          </ol>
          <div className="card eq-card">
            <div className="eq">
              H = K · R<sub>Δ</sub> · K<sup>−1</sup>
            </div>
            <div className="eq-legend">
              <span>K</span> projection intrinsics
              <br />
              <span>
                R<sub>Δ</sub>
              </span>{' '}
              head rotation between render pose and latest pose
            </div>
            <ul className="small-list">
              <li>One full-screen resample per eye: small, fixed cost</li>
              <li>Translation and parallax need depth</li>
              <li>Uncovered edges need a guard band</li>
            </ul>
          </div>
        </div>
        <div className="callout">
          Hard constraint: the warp must <b>start late enough</b> to use a fresh pose and <b>finish before vsync</b>,
          every frame.
        </div>
      </Frame>
    ),
  },
  {
    id: 'timing',
    Component: ({ active }) => (
      <Frame kicker="The scheduling problem" title="When should the LSR thread wake up?">
        <VsyncTimeline active={active} />
        <div className="callout">
          Wake too early → stale pose. Wake too late → missed vsync. <b>Jitter</b> decides how close you can cut it.
        </div>
      </Frame>
    ),
  },
  {
    id: 'fence',
    Component: () => (
      <Frame kicker="The primitive" title="A fence signaled every refresh, offset from vsync">
        <div className="cols cols-wide-left">
          <ul className="bullets">
            <li>Signaled by the OS every refresh, a fixed offset before vblank. The value counts up by one each time</li>
            <li>Waitable like any GPU fence by CPU threads and GPU queues. No polling, no sleep()</li>
            <li>On a GPU, the display driver drives it from its vblank interrupt</li>
          </ul>
          <div className="card layers">
            <div className="card-kicker">Same idea, three layers</div>
            <div className="layer">
              <span>WinRT</span>
              <code>
                DisplayDevice.CreatePeriodicFence(
                <wbr />
                target, offsetFromVBlank)
              </code>
            </div>
            <div className="layer">
              <span>D3DKMT</span>
              <code>D3DDDI_PERIODIC_MONITORED_FENCE</code>
            </div>
            <div className="layer">
              <span>KMD DDI</span>
              <code>DxgkDdiCreatePeriodicFrameNotification</code>
              <em>offset in 100 ns, at most one refresh</em>
            </div>
          </div>
        </div>
        <div className="callout">
          The catch: <b>indirect displays</b> have no display engine on the GPU and no vblank interrupt, so there is
          nothing to drive the fence.
        </div>
        <p className="note">
          The Indirect Display driver model (IddCx) is how Windows creates virtual and remote monitors: USB docks,
          wireless and virtual displays. Its main partners were DisplayLink and Intel.
        </p>
      </Frame>
    ),
  },
  {
    id: 'vsync-sources',
    Component: () => (
      <Frame kicker="The plumbing" title="How a vsync reaches dxgkrnl">
        <VsyncSources />
      </Frame>
    ),
  },
  {
    id: 'compositor',
    Component: () => (
      <Frame kicker="The consumer" title="One frame of the VR compositor">
        <div className="cols compositor-cols">
          <Code code={COMPOSITOR_SETUP} highlight={COMPOSITOR_APIS} title="Setup · C++/WinRT + D3D12" />
          <div className="compositor-frame">
            <Code code={COMPOSITOR_FRAME} highlight={COMPOSITOR_APIS} title="Per frame · buffer i, target refresh k" />
            <table className="fence-table">
              <thead>
                <tr>
                  <th>Fence</th>
                  <th>Direction</th>
                  <th>Signaled</th>
                </tr>
              </thead>
              <tbody>
                {COMPOSITOR_FENCES.map(([name, dir, when]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{dir}</td>
                    <td>{when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="caption">
          The warp waits for the display (tick), and the flip waits for the GPU (renderDone). TryExecuteTask only queues
          the flip and returns.
        </p>
      </Frame>
    ),
  },
  {
    id: 'architecture',
    Component: ({ active }) => (
      <Frame kicker="What I built" title="DisplayTask on an indirect display">
        <div className="arch-diagram">
          <FencePipeline active={active} />
        </div>
      </Frame>
    ),
  },
  {
    id: 'under-the-hood',
    Component: () => (
      <Frame kicker="Under the hood" title="Frames go out, timing comes back">
        <div className="cols code-cols">
          <Code code={DRIVER_CODE} highlight={DRIVER_APIS} title="IddCx driver · user mode" />
          <Code
            code={KERNEL_CODE}
            highlight={KERNEL_APIS}
            title={
              <>
                Dxgkrnl vsync emulation · <em>pseudocode</em>
              </>
            }
          />
        </div>
        <div className="cols cols-3 tight facts">
          <div className="fact">
            <b>PresentDisplayQPCTime</b>
            <span>The OS tells the driver when each frame should reach the remote screen.</span>
          </div>
          <div className="fact">
            <b>COMPLETED / DROPPED</b>
            <span>Per-frame status and send timestamps flow back to the OS.</span>
          </div>
          <div className="fact">
            <b>High-res timers</b>
            <span>Relative due time in 100 ns. Up to ~1 ms late, never early. Re-armed every flip.</span>
          </div>
        </div>
      </Frame>
    ),
  },
  {
    id: 'phase',
    Component: () => (
      <Frame kicker="Staying in sync" title="Staying in phase with a panel you can't see">
        <div className="cols phase-cols">
          <PhaseDrift />
          <div className="signals">
            <div className="signal">
              <span className="sig-dir">out →</span>
              <code>IDDCX_METADATA.PresentDisplayQPCTime</code>
              <span>when the OS wants this frame on the remote screen</span>
            </div>
            <div className="signal">
              <span className="sig-dir">← back</span>
              <code>IddCxSwapChainReportFrameStatistics</code>
              <span>
                <code>FrameStatus</code> COMPLETED / DROPPED, <code>FrameAcquireQpcTime</code>,{' '}
                <code>SendStart/Stop/CompleteQpcTime</code>
              </span>
            </div>
            <div className="signal">
              <span className="sig-dir">kept</span>
              <code>D3DKMT_PRESENT_STATS</code>
              <span>
                <code>PresentRefreshCount</code> vs <code>PresentCount</code>: a jump &gt; 1 is a missed vblank. Surfaced as{' '}
                <code>IDXGIOutput::GetFrameStatistics</code>
              </span>
            </div>
            <div className="signal accent">
              <span className="sig-dir">↻ loop</span>
              <code>re-phase every flip</code>
              <span>the emulated vblank, and the periodic fence riding on it, follow the feedback</span>
            </div>
          </div>
        </div>
      </Frame>
    ),
  },
  {
    id: 'edge-cases',
    Component: () => (
      <Frame kicker="Edge cases" title="Edge cases to consider">
        <div className="cols cols-2x2 hard-grid">
          <div className="card compact">
            <h3>The remote panel drifts</h3>
            <p className="muted">The real vblank fires on another device, on its own crystal.</p>
            <p>
              The driver reports whether each flip made it (IDDCX_FRAME_STATUS), and the present statistics show missed
              vblanks (PresentRefreshCount vs. PresentCount). That feedback keeps the emulated vsync in phase with the
              remote TCON.
            </p>
          </div>
          <div className="card compact">
            <h3>The mode changes mid-wait</h3>
            <p className="muted">Every mode change recreates the primaries and the swapchain.</p>
            <p>
              Pending periodic fences are set to their max value and signaled exactly once, so no waiter hangs. On its
              next present the compositor sees the swapchain is gone, recreates its primaries and gets the new
              swapchain from IddCx.
            </p>
          </div>
          <div className="card compact">
            <h3>A second fence is requested</h3>
            <p className="muted">One timer per device keeps the kernel thread simple.</p>
            <p>
              The fence lives inside the DisplayTask object, which owns all contact with the vsync emulation thread.
              That thread arms its own high-res timer only while a periodic fence exists, so a display-only device
              gets at most one. Fine: the AR/VR/MR compositor is its only client.
            </p>
          </div>
          <div className="card compact">
            <h3>The deadline and the timer use different clocks</h3>
            <p className="muted">QPC ticks above, 100 ns timer units below.</p>
            <p>
              The compositor, IddCx and DisplayTask keep time in QueryPerformanceCounter ticks. The high-resolution timer
              wants a relative delay in 100 ns units. Every arm converts QPC deadline → 100 ns delay
              (KeQueryInterruptTimePrecise returns both clocks from one read). Rounding or a stale &quot;now&quot; lands
              directly in the jitter.
            </p>
          </div>
        </div>
      </Frame>
    ),
  },
  {
    id: 'qa',
    Component: () => (
      <div className="title-slide qa">
        <div className="kicker">Recap</div>
        <ul className="recap">
          <li>LSR makes head motion feel instant, if it runs on time</li>
          <li>Periodic fences turn &quot;on time&quot; into an OS primitive</li>
          <li>On indirect displays, the fence rides an emulated vsync kept in phase by present statistics</li>
        </ul>
        <h1>Questions?</h1>
        <div className="byline">Shantanu Gupta</div>
      </div>
    ),
  },
  {
    id: 'bonus-slicer',
    Component: () => (
      <Frame kicker="Bonus · Markforged slicer" title="What a slicer does with one layer">
        <div className="cols slicer-cols">
          <SlicerLayer />
          <table className="lessons slicer-table">
            <thead>
              <tr>
                <th>Toolpath</th>
                <th>Generated by</th>
                <th>Main constraint</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['wall', 'Walls', 'inward offsets of the outline', 'bead width, smallest feature'],
                  ['skin', 'Solid skin', 'dense lines on top and bottom layers', 'must close the surface'],
                  ['infill', 'Infill', 'a lattice clipped to the region', 'needs room for the pattern'],
                  ['support', 'Support', 'sparse pattern under overhangs', 'overhang angle, easy removal'],
                  ['fibre', 'Carbon fibre', 'rings or routed strands', 'minimum length, tightest bend'],
                ] as const
              ).map(([c, name, how, limit]) => (
                <tr key={c}>
                  <td>
                    <span className="swatch" style={{ background: LAYER_COLORS[c] }} />
                    {name}
                  </td>
                  <td>{how}</td>
                  <td>{limit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="callout">
          Continuous carbon fibre stiffens the part: <b>bending, torsional and shear rigidity</b> well beyond plastic
          alone. But a strand has a <b>minimum length</b> and a <b>tightest bend radius</b>.
        </div>
      </Frame>
    ),
  },
  {
    id: 'bonus-mat',
    Component: ({ active }) => (
      <Frame kicker="Bonus · medial axis" title="Approximating the medial axis with a triangulation">
        <MatStages active={active} />
        <p className="caption">
          After Smogavec &amp; Žalik, &quot;A fast algorithm for constructing approximate medial axis of polygons, using
          Steiner points&quot;, Advances in Engineering Software 52 (2012).
        </p>
      </Frame>
    ),
  },
  {
    id: 'bonus-toolpaths',
    Component: () => (
      <Frame kicker="Bonus · from axis to toolpath" title="Two jobs for the same skeleton">
        <MatToolpaths />
      </Frame>
    ),
  },
  {
    id: 'refs',
    Component: () => (
      <Frame title="References">
        <div className="cols refs">
          <ul>
            <li>
              <b>Windows.Devices.Display.Core</b>: DisplayDevice.CreatePeriodicFence, DisplayTask (SetScanout,
              SetWait, SetSignal), DisplayTaskPool.TryExecuteTask, DisplayTaskResult.PresentId
            </li>
            <li>
              <b>Building a custom compositor for head-mounted and specialized monitors</b> (WDK docs)
            </li>
            <li>
              <b>IDisplayDeviceInterop</b>: CreateSharedHandle / OpenSharedHandle, share primaries and fences with
              D3D12
            </li>
          </ul>
          <ul>
            <li>
              <b>Indirect Display Driver model overview</b> and the IndirectDisplay sample, Windows-driver-samples
            </li>
            <li>
              <b>IddCxSwapChainReleaseAndAcquireBuffer</b>, IDDCX_METADATA, IddCxSwapChainReportFrameStatistics,
              IDDCX_FRAME_STATISTICS
            </li>
            <li>
              <b>D3DDDI_PERIODIC_MONITORED_FENCE</b>, DXGKARG_CREATEPERIODICFRAMENOTIFICATION
            </li>
            <li>
              <b>High-resolution timers</b>, Timer Accuracy, ExAllocateTimer, ExSetTimer, KeQueryInterruptTimePrecise
            </li>
            <li>
              <b>Saving Energy with VSync Control</b> (display-only VSync), KMDDOD_INITIALIZATION_DATA,
              DXGK_INTERRUPT_TYPE, DXGKARGCB_NOTIFY_INTERRUPT_DATA
            </li>
            <li>
              <b>D3DKMT_PRESENT_STATS</b>, DXGI_FRAME_STATISTICS, IDXGIOutput::GetFrameStatistics
            </li>
          </ul>
        </div>
        <div className="refs-paper">
          <div className="card-kicker">Medial axis</div>
          <p>
            Smogavec &amp; Žalik, <b>&quot;A fast algorithm for constructing approximate medial axis of polygons, using
            Steiner points&quot;</b>, Advances in Engineering Software 52 (2012) 1–9
          </p>
        </div>
      </Frame>
    ),
  },
];
