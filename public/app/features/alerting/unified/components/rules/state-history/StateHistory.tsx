import { css } from '@emotion/css';
import { groupBy } from 'lodash';
import { FormEvent, useCallback, useState } from 'react';
import * as React from 'react';

import { AlertState, GrafanaTheme2, dateTimeFormat } from '@grafana/data';
import { Trans, t } from '@grafana/i18n';
import { Alert, Field, Icon, Input, Label, LoadingPlaceholder, Stack, Tooltip, useStyles2 } from '@grafana/ui';
import { StateHistoryItem, StateHistoryItemData } from 'app/types/unified-alerting';
import { GrafanaAlertStateWithReason, PromAlertingRuleState } from 'app/types/unified-alerting-dto';

import { useManagedAlertStateHistory } from '../../../hooks/useManagedAlertStateHistory';
import { AlertLabel } from '../../AlertLabel';
import { DynamicTable, DynamicTableColumnProps, DynamicTableItemProps } from '../../DynamicTable';
import { AlertStateTag } from '../AlertStateTag';

type StateHistoryRowItem = {
  id: string;
  state: PromAlertingRuleState | GrafanaAlertStateWithReason | AlertState;
  text?: string;
  data?: StateHistoryItemData;
  timestamp?: number;
  stringifiedLabels: string;
};

type StateHistoryMap = Record<string, StateHistoryRowItem[]>;

type StateHistoryRow = DynamicTableItemProps<StateHistoryRowItem>;

interface Props {
  ruleUID: string;
}

const StateHistory = ({ ruleUID }: Props) => {
  const [textFilter, setTextFilter] = useState<string>('');
  const handleTextFilter = useCallback((event: FormEvent<HTMLInputElement>) => {
    setTextFilter(event.currentTarget.value);
  }, []);

  const { loading, error, result = [] } = useManagedAlertStateHistory(ruleUID);

  const styles = useStyles2(getStyles);

  if (loading && !error) {
    return <LoadingPlaceholder text={t('alerting.state-history.text-loading-history', 'Loading history...')} />;
  }

  if (error && !loading) {
    return (
      <Alert
        title={t(
          'alerting.state-history.title-failed-to-fetch-alert-state-history',
          'Failed to fetch alert state history'
        )}
      >
        {error.message}
      </Alert>
    );
  }

  const columns: Array<DynamicTableColumnProps<StateHistoryRowItem>> = [
    {
      id: 'state',
      label: t('alerting.state-history.columns.label.state', 'State'),
      size: 'max-content',
      renderCell: renderStateCell,
    },
    { id: 'value', label: '', size: 'auto', renderCell: renderValueCell },
    {
      id: 'timestamp',
      label: t('alerting.state-history.columns.label.time', 'Time'),
      size: 'max-content',
      renderCell: renderTimestampCell,
    },
  ];

  // group the state history list by unique set of labels
  const tables = Object.entries(groupStateByLabels(result))
    // sort and filter each table
    .sort()
    .filter(([groupKey]) => matchKey(groupKey, textFilter))
    .map(([groupKey, items]) => {
      const tableItems: StateHistoryRow[] = items.map((historyItem) => ({
        id: historyItem.id,
        data: historyItem,
      }));

      return (
        <div key={groupKey}>
          <header className={styles.tableGroupKey}>
            <code className={styles.goupKeyText} aria-label={groupKey}>
              {groupKey}
            </code>
          </header>
          <DynamicTable cols={columns} items={tableItems} pagination={{ itemsPerPage: 25 }} />
        </div>
      );
    });

  return (
    <div>
      <nav>
        <Field
          label={
            <Label>
              <Stack gap={0.5} alignItems="center">
                <span>
                  <Trans i18nKey="alerting.state-history.filter-group">Filter group</Trans>
                </span>
                <Tooltip
                  content={
                    <div>
                      <Trans i18nKey="alerting.state-history.filter-group-tooltip">
                        Filter each state history group either by exact match or a regular expression, for example:
                      </Trans>
                      <div>
                        <code>{`region=eu-west-1`}</code>
                        <code>{`/region=us-.+/`}</code>
                      </div>
                    </div>
                  }
                >
                  <Icon name="info-circle" size="sm" />
                </Tooltip>
              </Stack>
            </Label>
          }
        >
          <Input
            prefix={<Icon name={'search'} />}
            onChange={handleTextFilter}
            placeholder={t('alerting.state-history.placeholder-search', 'Search')}
          />
        </Field>
      </nav>
      {tables}
    </div>
  );
};

// group state history by labels
export function groupStateByLabels(
  history: Array<Pick<StateHistoryItem, 'id' | 'newState' | 'text' | 'data' | 'updated'>>
): StateHistoryMap {
  const items: StateHistoryRowItem[] = history.map((item) => {
    // let's grab the last matching set of `{<string>}` since the alert name could also contain { or }
    const LABELS_REGEX = /{.*?}/g;
    const stringifiedLabels = item.text.match(LABELS_REGEX)?.at(-1) ?? '';

    return {
      id: String(item.id),
      state: item.newState,
      // let's omit the labels for each entry since it's just added noise to each state history item
      text: item.text.replace(stringifiedLabels, ''),
      data: item.data,
      timestamp: item.updated,
      stringifiedLabels,
    };
  });

  // we have to group our state history items by their unique combination of tags since we want to display a DynamicTable for each alert instance
  // (effectively unique combination of labels)
  return groupBy(items, (item) => item.stringifiedLabels);
}

// match a string either by exact text match or with regular expression when in the form of "/<regex>/"
export function matchKey(groupKey: string, textFilter: string) {
  // if the text filter is empty we show all matches
  if (textFilter === '') {
    return true;
  }

  const isRegExp = textFilter.startsWith('/') && textFilter.endsWith('/');

  // not a regular expression, use normal text matching
  if (!isRegExp) {
    return groupKey.includes(textFilter);
  }

  // regular expression, try parsing and applying
  // when we fail to parse the text as a regular expression, we return no match
  try {
    return new RegExp(textFilter.slice(1, -1)).test(groupKey);
  } catch (err) {
    return false;
  }
}

function renderValueCell(item: StateHistoryRow) {
  const matches = item.data.data?.evalMatches ?? [];

  return (
    <>
      {item.data.text}
      <LabelsWrapper>
        {matches.map((match) => (
          <AlertLabel key={match.metric} labelKey={match.metric} value={String(match.value)} />
        ))}
      </LabelsWrapper>
    </>
  );
}

function renderStateCell(item: StateHistoryRow) {
  return <AlertStateTag state={item.data.state} />;
}

function renderTimestampCell(item: StateHistoryRow) {
  return (
    <div className={TimestampStyle}>{item.data.timestamp && <span>{dateTimeFormat(item.data.timestamp)}</span>}</div>
  );
}

const LabelsWrapper = ({ children }: React.PropsWithChildren<{}>) => {
  const { wrapper } = useStyles2(getStyles);
  return <div className={wrapper}>{children}</div>;
};

const TimestampStyle = css({
  display: 'flex',
  alignItems: 'flex-end',
  flexDirection: 'column',
});

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    '& > *': {
      marginRight: theme.spacing(1),
    },
  }),
  tableGroupKey: css({
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(2),
  }),
  goupKeyText: css({
    overflowX: 'auto',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'block',
  }),
});

export default StateHistory;
