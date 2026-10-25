// Draft submittals must not claim a submitted date, and the timeline must not repeat a generic "in review."
import { describe, expect, it } from "vitest";
import {
  renderSubmittalRecordBody,
  submittalRecordTimeline,
  type RecordEventRow,
  type SubmittalRecordPayload,
} from "./submittal-record-page";
import { SUBMITTAL_DRAFT_LABEL } from "./mcp/submittals";

const JOB = "11111111-1111-4111-8111-111111111111";

function event(
  over: Partial<RecordEventRow> & Pick<RecordEventRow, "id" | "summary">,
): RecordEventRow {
  return {
    occurred_at: "2026-10-15T12:00:00Z",
    actor: "user",
    actor_name: "Pat",
    kind: "submittal_status",
    title: "Submittal 05 12 00-001 revision 0",
    payload: { status: "in_review" },
    ...over,
  };
}

function payload(over: Partial<SubmittalRecordPayload> = {}): SubmittalRecordPayload {
  return {
    page: "submittal",
    job_id: JOB,
    job_number: "2701",
    job_name: "Harbor",
    today: "2026-10-25",
    number: "05 12 00-001",
    current: {
      id: "s-051200",
      number: "05 12 00-001",
      revision: 0,
      transmittal_number: 13,
      spec_section: "05 12 00",
      title: "Structural steel",
      submittal_type: "shop_drawing",
      status: "in_review",
      ball_in_court: "gc",
      source: "user",
      required: true,
      submitted_on: "2026-10-15",
      due_back: "2026-10-29",
      returned_on: null,
      submission_sent_at: null,
      created_at: "2026-10-14T15:00:00Z",
      package_items: [],
    },
    packages: [
      {
        id: "pkg-14",
        submittal_id: "s-051200",
        revision: 0,
        is_current: true,
        transmittal_number: 13,
        filename: "Submittal-05-12-00-001.pdf",
        path: "c/j/packages/pkg-14/x.pdf",
        page_count: 8,
        created_at: "2026-10-15T16:00:00Z",
        sent_at: null,
      },
    ],
    revisions: [
      {
        id: "s-051200",
        revision: 0,
        status: "in_review",
        title: "Structural steel",
        spec_section: "05 12 00",
        transmittal_number: 13,
        submitted_on: "2026-10-15",
        ball_in_court: "gc",
        created_at: "2026-10-14T15:00:00Z",
      },
    ],
    ...over,
  };
}

function whatItIs(html: string): string {
  const start = html.indexOf("WHAT IT IS");
  const end = html.indexOf("PACKAGE PIECES");
  return html.slice(start, end === -1 ? undefined : end);
}

describe("submittal record dates and timeline", () => {
  it("does not call an unsent draft submitted, and matches the display status", () => {
    const html = renderSubmittalRecordBody(payload());
    const what = whatItIs(html);
    expect(html).toContain(SUBMITTAL_DRAFT_LABEL);
    expect(what).toContain("Not yet submitted");
    expect(what).toContain("Drafted 2026-10-14");
    expect(what).not.toContain("Submitted");
    expect(what).toContain("Package send receipt not recorded");
  });

  it("shows the submitted date once a send receipt or a submitted-or-later status is real", () => {
    const sent = payload({
      current: {
        ...payload().current,
        status: "in_review",
        submission_sent_at: "2026-10-20T18:00:00Z",
      },
      packages: [{ ...payload().packages![0], sent_at: "2026-10-20T18:00:00Z" }],
    });
    const sentHtml = whatItIs(renderSubmittalRecordBody(sent));
    expect(sentHtml).toContain("Submitted 2026-10-20");
    expect(sentHtml).not.toContain("Not yet submitted");
    expect(renderSubmittalRecordBody(sent)).toContain("In review");
    expect(renderSubmittalRecordBody(sent)).not.toContain(SUBMITTAL_DRAFT_LABEL);

    const logged = payload({
      current: {
        ...payload().current,
        status: "submitted",
        submitted_on: "2026-10-15",
        created_at: "2026-10-01",
      },
      packages: [],
    });
    expect(whatItIs(renderSubmittalRecordBody(logged))).toContain("Submitted 2026-10-15");

    const prep = payload({
      current: { ...payload().current, status: "in_prep" },
      packages: [],
    });
    expect(whatItIs(renderSubmittalRecordBody(prep))).toContain("Not yet submitted");
    expect(whatItIs(renderSubmittalRecordBody(prep))).not.toContain("Submitted");
  });

  it("drops generic in-review echoes and collapses consecutive duplicate timeline entries", () => {
    const reviews = [1, 2, 3, 4, 5, 6].map((n) =>
      event({
        id: `review-${n}`,
        occurred_at: `2026-10-2${n}T12:00:00Z`,
        summary: "Structural steel. Spec 05 12 00. in review.",
      }),
    );
    const sent = event({
      id: "sent-1",
      kind: "submittal_sent",
      title: "Sent: 05 12 00-001 revision 0",
      summary: "Email to reviewer@example.com. Provider receipt local: m1.",
      payload: { status: "submitted" },
      occurred_at: "2026-10-20T12:00:00Z",
    });
    const sentAgain = { ...sent, id: "sent-2", occurred_at: "2026-10-20T12:05:00Z" };
    const prep = event({
      id: "prep-1",
      summary: "Structural steel. Spec 05 12 00. in prep.",
      payload: { status: "in_prep" },
      occurred_at: "2026-10-14T12:00:00Z",
    });
    const created = event({
      id: "created",
      kind: "submittal_created",
      summary: "Structural steel. Spec 05 12 00. not started.",
      payload: { status: "not_started" },
      occurred_at: "2026-10-14T11:00:00Z",
    });
    const prepLater = { ...prep, id: "prep-2", occurred_at: "2026-10-13T12:00:00Z" };
    const comments = event({
      id: "comments",
      title: "Reviewer comments",
      summary: "Returned with comments on the weld procedure.",
      payload: { status: "in_review" },
      occurred_at: "2026-10-21T12:00:00Z",
    });
    const events = [...reviews, sent, sentAgain, prep, created, prepLater, comments];
    expect(submittalRecordTimeline(events).map((e) => e.id)).toEqual([
      "sent-1",
      "prep-1",
      "created",
      "prep-2",
      "comments",
    ]);
    const html = renderSubmittalRecordBody(payload({ events }));
    expect(html).not.toContain("in review.");
    expect(html.match(/id="event-/g)).toHaveLength(5);
    expect(html.indexOf('id="event-sent-1"')).toBeLessThan(html.indexOf('id="event-prep-1"'));
    expect(html.indexOf('id="event-prep-1"')).toBeLessThan(html.indexOf('id="event-created"'));
    expect(html.indexOf('id="event-created"')).toBeLessThan(html.indexOf('id="event-prep-2"'));
    expect(html.indexOf('id="event-prep-2"')).toBeLessThan(html.indexOf('id="event-comments"'));
    expect(html).toContain("Email to reviewer@example.com");
    expect(html).toContain("Returned with comments on the weld procedure.");
  });

  it("leaves request and change-order submitted dates and timelines unchanged", () => {
    const events = [1, 2].map((n) =>
      event({ id: `r-${n}`, summary: "Question. Spec 05 12 00. in review." }),
    );
    const base = payload({ events, packages: [] });
    const rfi = renderSubmittalRecordBody({
      ...base,
      current: { ...base.current, package_purpose: "rfi" },
    });
    expect(whatItIs(rfi)).toContain("Submitted 2026-10-15");
    expect(rfi.match(/in review\./g)).toHaveLength(2);
    const change = renderSubmittalRecordBody({
      ...base,
      current: { ...base.current, package_purpose: "change_order" },
    });
    expect(whatItIs(change)).toContain("Submitted 2026-10-15");
    expect(change.match(/in review\./g)).toHaveLength(2);
  });
});
