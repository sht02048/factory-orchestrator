import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  CapacityBar,
  Card,
  GroupHeader,
  ProblemCallout,
  Row,
  SURFACE_ROLES,
  Section,
  SegmentedTabs,
  StatTile,
  StatusDot,
  StatusPill,
  Text,
  textStyles,
} from "@factory/ui";
import { colors, space } from "@factory/ui/tokens.stylex";
import { useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useStatusName } from "../status";

export const roleSectionIds = [
  "surfaces",
  "statusDot",
  "sections",
  "segmented",
  "groupHeader",
  "capacity",
  "problem",
  "statTile",
] as const;

type Period = "7d" | "14d" | "30d";
type Split = "runner" | "agent" | "project";

function Demo({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.demo)}>{children}</div>;
}

export function RoleSections() {
  const t = useTranslations("ds");
  const statusName = useStatusName();
  const [period, setPeriod] = useState<Period>("7d");
  const [split, setSplit] = useState<Split>("runner");

  return (
    <>
      <div id="surfaces">
        <Section title={t("nav.surfaces")} note={t("surfaces.note")}>
          <div {...stylex.props(styles.surfaces)}>
            {SURFACE_ROLES.map((surface) => (
              <Card key={surface} surface={surface}>
                <Text variant="label">{surface}</Text>
                <Text variant="body">{t(`surfaces.${surface}`)}</Text>
              </Card>
            ))}
          </div>
        </Section>
      </div>

      <div id="statusDot">
        <Section title={t("nav.statusDot")} note={t("statusDot.note")}>
          <Demo>
            <div {...stylex.props(styles.stack)}>
              <Section title="In progress" titleRole="heading" count={2}>
                <Row
                  interactive={false}
                  leading={<StatusDot status="running">{statusName("running")}</StatusDot>}
                  trailing="25분째"
                >
                  <Text variant="title">{t("statusDot.running")}</Text>
                </Row>
                <Row
                  interactive={false}
                  leading={
                    <StatusDot status="waiting-for-input">
                      {statusName("waiting-for-input")}
                    </StatusDot>
                  }
                  trailing="3분째"
                >
                  <Text variant="title">{t("statusDot.waiting")}</Text>
                </Row>
                <Row
                  interactive={false}
                  leading={<StatusDot status="queued">{statusName("queued")}</StatusDot>}
                  trailing="방금"
                >
                  <Text variant="title">{t("statusDot.queued")}</Text>
                </Row>
              </Section>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="sections">
        <Section title={t("nav.sections")} note={t("sections.note")}>
          <Demo>
            <div {...stylex.props(styles.stack)}>
              <Section
                title="To do"
                titleRole="heading"
                count={3}
                link={{ href: "#sections", label: t("sections.link") }}
              >
                <Text variant="meta">{t("sections.headingBody")}</Text>
              </Section>
              <Section title="Runners" titleRole="subheading" count={2}>
                <Text variant="meta">{t("sections.subheadingBody")}</Text>
              </Section>
              <p {...stylex.props(textStyles("display"))}>{t("sections.display")}</p>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="segmented">
        <Section title={t("nav.segmented")} note={t("segmented.note")}>
          <Demo>
            <SegmentedTabs<Period>
              value={period}
              onValueChange={setPeriod}
              label={t("segmented.periodLabel")}
              items={[
                { value: "7d", label: t("segmented.days7"), count: 18 },
                { value: "14d", label: t("segmented.days14"), count: 31 },
                { value: "30d", label: t("segmented.days30"), count: 64 },
              ]}
            />
            <SegmentedTabs<Split>
              value={split}
              onValueChange={setSplit}
              label={t("segmented.splitLabel")}
              items={[
                { value: "runner", label: t("segmented.byRunner") },
                { value: "agent", label: t("segmented.byAgent") },
                { value: "project", label: t("segmented.byProject") },
              ]}
            />
          </Demo>
        </Section>
      </div>

      <div id="groupHeader">
        <Section title={t("nav.groupHeader")} note={t("groupHeader.note")}>
          <Demo>
            <div {...stylex.props(styles.stack)}>
              <GroupHeader
                status="question"
                title={t("groupHeader.answerTitle")}
                count={2}
                description={t("groupHeader.answer")}
              />
              <GroupHeader
                status="human-check"
                title={t("groupHeader.checkTitle")}
                count={1}
                description={t("groupHeader.check")}
              />
              <GroupHeader
                status="failed"
                title={t("groupHeader.stuckTitle")}
                count={7}
                description={t("groupHeader.stuck")}
              />
            </div>
          </Demo>
        </Section>
      </div>

      <div id="capacity">
        <Section title={t("nav.capacity")} note={t("capacity.note")}>
          <Demo>
            <div {...stylex.props(styles.stack)}>
              <Card padding="compact">
                <Row
                  interactive={false}
                  leading={<StatusPill status="online">{statusName("online")}</StatusPill>}
                  trailing={
                    <span {...stylex.props(styles.capacity)}>
                      <CapacityBar used={1} total={2} label={t("capacity.label")} />
                    </span>
                  }
                >
                  <Text variant="title">runner-a</Text>
                </Row>
                <Row
                  interactive={false}
                  leading={<StatusPill status="online">{statusName("online")}</StatusPill>}
                  trailing={
                    <span {...stylex.props(styles.capacity)}>
                      <CapacityBar used={3} total={3} label={t("capacity.label")} />
                    </span>
                  }
                >
                  <Text variant="title">runner-b</Text>
                </Row>
                <Row
                  interactive={false}
                  leading={
                    <StatusPill status="runner-issue">{statusName("runner-issue")}</StatusPill>
                  }
                  trailing={
                    <span {...stylex.props(styles.capacity)}>
                      <CapacityBar used={0} total={2} label={t("capacity.label")} tone="problem" />
                    </span>
                  }
                >
                  <Text variant="title">runner-c</Text>
                </Row>
              </Card>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="problem">
        <Section title={t("nav.problem")} note={t("problem.note")}>
          <Demo>
            <div {...stylex.props(styles.stack)}>
              <ProblemCallout
                title={t("problem.title")}
                steps={[t("problem.step1"), t("problem.step2")]}
                actions={
                  <Actions>
                    <Button>{t("problem.recheck")}</Button>
                  </Actions>
                }
              >
                {t("problem.body")}
              </ProblemCallout>
              <ProblemCallout title={t("problem.offlineTitle")}>
                {t("problem.offlineBody")}
              </ProblemCallout>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="statTile">
        <Section title={t("nav.statTile")} note={t("statTile.note")}>
          <div {...stylex.props(styles.tiles)}>
            <StatTile
              value="42"
              label={t("statTile.done")}
              detail={t("statTile.doneDetail")}
              trend="better"
            />
            <StatTile
              value="6"
              label={t("statTile.failed")}
              detail={t("statTile.failedDetail")}
              trend="worse"
            />
            <StatTile value="12분" label={t("statTile.wait")} detail={t("statTile.waitDetail")} />
          </div>
        </Section>
      </div>
    </>
  );
}

const styles = stylex.create({
  demo: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s4,
    paddingBlock: space.s5,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  stack: { display: "flex", flexDirection: "column", gap: space.s4, width: "100%", maxWidth: 640 },
  surfaces: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: space.s3,
  },
  capacity: { display: "block", width: 160 },
  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: space.s3,
  },
});
