// Three ways a vblank reaches dxgkrnl, per the WDK docs. Lane C's last step is the CPU periodic fence.
type Step = { role: string; code?: string; text: string; tone?: 'warn' | 'accent' };
type Lane = { title: string; sub: string; highlight?: boolean; steps: (Step | string)[] };

const LANES: Lane[] = [
  {
    title: 'GPU display driver',
    sub: 'full WDDM kernel-mode driver',
    steps: [
      { role: 'Hardware', text: 'Display controller enters vblank' },
      'IRQ',
      { role: 'KMD ISR', code: 'DxgkCbNotifyInterrupt(DXGK_INTERRUPT_CRTC_VSYNC)', text: 'from DxgkDdiInterruptRoutine' },
      'DPC',
      { role: 'Dxgkrnl', text: 'Flip retires; present statistics advance' },
      '',
      {
        role: 'Periodic fence',
        code: 'DxgkDdiCreatePeriodicFrameNotification',
        text: 'Driver raises DXGK_INTERRUPT_PERIODIC_MONITORED_FENCE_SIGNALED at vsync − Time',
      },
    ],
  },
  {
    title: 'Display-only driver with VSync',
    sub: 'KMDOD that reports interrupts',
    steps: [
      { role: 'Hardware', text: 'Scan-out hardware with a vblank interrupt' },
      'IRQ',
      {
        role: 'KMDOD ISR',
        code: 'DXGK_INTERRUPT_DISPLAYONLY_VSYNC',
        text: 'Requires DxgkDdiControlInterrupt + DxgkDdiGetScanLine',
      },
      'DPC',
      {
        role: 'Dxgkrnl',
        code: 'DxgkDdiPresentDisplayOnly',
        text: 'Async completion via DXGK_INTERRUPT_DISPLAYONLY_PRESENT_PROGRESS',
      },
      '',
      {
        role: 'Periodic fence',
        text: 'No DDI: KMDDOD_INITIALIZATION_DATA has no DxgkDdiCreatePeriodicFrameNotification',
        tone: 'warn',
      },
    ],
  },
  {
    title: 'Display-only without VSync · IddCx',
    sub: 'remote and virtual monitors',
    highlight: true,
    steps: [
      { role: 'Remote device', text: "The panel's TCON owns the real vblank, out of the host's reach" },
      'no IRQ',
      {
        role: 'Driver',
        code: 'vSyncFreq = D3DKMDT_FREQUENCY_NOTSPECIFIED',
        text: 'No DxgkDdiControlInterrupt, no DxgkDdiGetScanLine',
      },
      '',
      {
        role: 'Dxgkrnl',
        text: 'Simulates VSync interrupts and scan lines from the current mode and the time of the last simulated VSync',
      },
      '',
      {
        role: 'Periodic fence',
        text: 'The emulation thread arms a high-res timer at vblank − offset; the CPU signals the fence (WARP path)',
        tone: 'accent',
      },
    ],
  },
];

export default function VsyncSources() {
  return (
    <div className="lanes">
      {LANES.map((lane) => (
        <div key={lane.title} className={lane.highlight ? 'lane highlight' : 'lane'}>
          <div className="lane-head">
            <b>{lane.title}</b>
            <span>{lane.sub}</span>
          </div>
          {lane.steps.map((s, i) =>
            typeof s === 'string' ? (
              <div key={i} className="lane-arrow">
                ↓ {s}
              </div>
            ) : (
              <div key={i} className={`lane-step ${s.tone ?? ''}`}>
                <span className="lane-role">{s.role}</span>
                {s.code && <code>{s.code}</code>}
                <span className="lane-text">{s.text}</span>
              </div>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
