import { useEffect, useRef, type ReactElement } from 'react';

import '../../styles/hero.css';
import { BAND_LABELS, HERO_TENDERS, type IllustrativeTender } from './decision-engine-data';
import { NoticeCard, PipelineConnector, SignalRow, VerdictBands } from './primitives';
import { ScoreRing } from './ScoreRing';

/**
 * Homepage hero visual: a miniature of BidMorrow doing its job. A TED
 * notice arrives, the eight qualification components check in with the
 * points they earned, the score draws to `n / 100`, and the tender settles
 * into its published band. Three illustrative tenders cycle (Strong match,
 * Worth reviewing, Low fit) on one 13.5 s loop.
 *
 * Motion is CSS only (`styles/hero.css`): every element in a scene runs a
 * one-shot 4.5 s animation, so nothing is scheduled from timers and the
 * browser pauses it all in background tabs. Only the playing scene is in
 * the render tree; the JavaScript here is (a) writing each scene's target
 * score into `--de-target` through the CSSOM (the count-up and the ring
 * read it; an inline `style` attribute would be an inline style under
 * the CSP, `setProperty` is not, matching `useTilt`), (b) one
 * `animationend` listener that, when a scene's own timeline ends, hides
 * it, shows the next and records the scene number on the root (which
 * restarts the next scene's animations and lights its band), and (c) one
 * IntersectionObserver that pauses the animation while the visual is
 * scrolled out of view. Hidden scenes and finished animations cost no
 * per-frame work, which keeps the loop cheap on slow phones.
 *
 * `prefers-reduced-motion: reduce` renders the first tender's finished
 * frame and nothing moves. The whole visual is one `role="img"` whose
 * label tells the same story in a sentence; the inner text is layout.
 */
export function DecisionEngine(): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    // Scene hand-over: the scene element's own `de-scene` animation ends
    // at 4.5 s; the next scene is shown (its animations start from zero)
    // and the finished one is hidden. Under reduced motion nothing
    // animates, so this never fires and scene one stays, still.
    const onAnimationEnd = (event: AnimationEvent): void => {
      if (event.animationName !== 'de-scene') return;
      const scenes = Array.from(root.querySelectorAll<HTMLElement>('.de__scene'));
      const index = scenes.indexOf(event.target as HTMLElement);
      const current = scenes[index];
      const next = scenes[(index + 1) % scenes.length];
      if (current === undefined || next === undefined) return;
      next.hidden = false;
      current.hidden = true;
      root.dataset['scene'] = String(((index + 1) % scenes.length) + 1);
    };
    root.addEventListener('animationend', onAnimationEnd);

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              if (entry === undefined) return;
              root.classList.toggle('is-offscreen', !entry.isIntersecting);
            },
            { threshold: 0.05 },
          );
    observer?.observe(root);
    return () => {
      root.removeEventListener('animationend', onAnimationEnd);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="de" role="img" aria-label={describe(HERO_TENDERS)} data-scene="1" ref={rootRef}>
      <div className="de__source">
        <span className="de__source-label">TED · OJ S · every morning</span>
        <span className="de__queue">
          <span className="de__queue-chip" />
          <span className="de__queue-chip" />
          <span className="de__queue-chip" />
        </span>
      </div>

      <div className="de__scenes">
        {HERO_TENDERS.map((tender, index) => (
          <Scene tender={tender} index={index} key={tender.id} />
        ))}
      </div>

      <VerdictBands />
      <p className="de__caption">Illustrative example, not live data</p>
    </div>
  );
}

function Scene({
  tender,
  index,
}: {
  readonly tender: IllustrativeTender;
  readonly index: number;
}): ReactElement {
  return (
    <div
      className={`de__scene de__scene--${String(index + 1)}`}
      hidden={index > 0}
      ref={(el) => {
        el?.style.setProperty('--de-target', String(tender.score));
      }}
    >
      <NoticeCard tender={tender} />
      <PipelineConnector />
      <div className="de-engine">
        <p className="de-engine__head">
          <span className="de-engine__title">BidMorrow qualification</span>
          <span className="de-engine__version">engine v1</span>
        </p>
        <ul className="de-signals">
          {tender.signals.map((signal) => (
            <SignalRow signal={signal} key={signal.label} />
          ))}
        </ul>
        <div className="de-score">
          <ScoreRing value={tender.score} mode="engine" className="de-score__ring" />
          <span className="de-score__num" />
          <span className="de-score__of">/ 100</span>
          <span className={`de-score__band de-score__band--${tender.band}`}>
            {BAND_LABELS[tender.band]}
          </span>
        </div>
      </div>
    </div>
  );
}

function describe(tenders: readonly IllustrativeTender[]): string {
  const outcomes = tenders
    .map(
      (t) =>
        `${t.buyer.replace(' · ', ', ')}: ${t.title}, ${String(t.score)} of 100, ${BAND_LABELS[t.band]}`,
    )
    .join('; ');
  return (
    'Illustration of BidMorrow qualifying three example tenders. Each notice is scored on eight ' +
    `components out of 100 points and placed in a published band. ${outcomes}. ` +
    'Illustrative example, not live data.'
  );
}
