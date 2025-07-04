import Prism, { Grammar } from 'prismjs';

import { DataFrame, dateTimeFormat, Labels, LogLevel, LogRowModel, LogsSortOrder } from '@grafana/data';
import { GetFieldLinksFn } from 'app/plugins/panel/logs/types';

import { checkLogsError, checkLogsSampled, escapeUnescapedString, sortLogRows } from '../../utils';
import { LOG_LINE_BODY_FIELD_NAME } from '../LogDetailsBody';
import { FieldDef, getAllFields } from '../logParser';

import { generateLogGrammar, generateTextMatchGrammar } from './grammar';
import { LogLineVirtualization } from './virtualization';

const TRUNCATION_DEFAULT_LENGTH = 50000;

export class LogListModel implements LogRowModel {
  collapsed: boolean | undefined = undefined;
  datasourceType: string | undefined;
  dataFrame: DataFrame;
  datasourceUid?: string;
  displayLevel: string;
  duplicates: number | undefined;
  entry: string;
  entryFieldIndex: number;
  hasAnsi: boolean;
  hasError: boolean;
  hasUnescapedContent: boolean;
  isSampled: boolean;
  labels: Labels;
  logLevel: LogLevel;
  raw: string;
  rowIndex: number;
  rowId?: string | undefined;
  searchWords: string[] | undefined;
  timestamp: string;
  timeFromNow: string;
  timeEpochMs: number;
  timeEpochNs: string;
  timeLocal: string;
  timeUtc: string;
  uid: string;
  uniqueLabels: Labels | undefined;

  private _body: string | undefined = undefined;
  private _currentSearch: string | undefined = undefined;
  private _grammar?: Grammar;
  private _highlightedBody: string | undefined = undefined;
  private _fields: FieldDef[] | undefined = undefined;
  private _getFieldLinks: GetFieldLinksFn | undefined = undefined;
  private _virtualization?: LogLineVirtualization;

  constructor(log: LogRowModel, { escape, getFieldLinks, grammar, timeZone, virtualization }: PreProcessLogOptions) {
    // LogRowModel
    this.datasourceType = log.datasourceType;
    this.dataFrame = log.dataFrame;
    this.datasourceUid = log.datasourceUid;
    this.duplicates = log.duplicates;
    this.entry = log.entry;
    this.entryFieldIndex = log.entryFieldIndex;
    this.hasAnsi = log.hasAnsi;
    this.hasError = !!checkLogsError(log);
    this.hasUnescapedContent = log.hasUnescapedContent;
    this.isSampled = !!checkLogsSampled(log);
    this.labels = log.labels;
    this.logLevel = log.logLevel;
    this.rowIndex = log.rowIndex;
    this.rowId = log.rowId;
    this.searchWords = log.searchWords;
    this.timeFromNow = log.timeFromNow;
    this.timeEpochMs = log.timeEpochMs;
    this.timeEpochNs = log.timeEpochNs;
    this.timeLocal = log.timeLocal;
    this.timeUtc = log.timeUtc;
    this.uid = log.uid;
    this.uniqueLabels = log.uniqueLabels;

    // LogListModel
    this.displayLevel = logLevelToDisplayLevel(log.logLevel);
    this._getFieldLinks = getFieldLinks;
    this._grammar = grammar;
    this.timestamp = dateTimeFormat(log.timeEpochMs, {
      timeZone,
      defaultWithMS: true,
    });
    this._virtualization = virtualization;

    let raw = log.raw;
    if (escape && log.hasUnescapedContent) {
      raw = escapeUnescapedString(raw);
    }
    this.raw = raw;
  }

  get body(): string {
    if (this._body === undefined) {
      this._body = this.collapsed
        ? this.raw.substring(0, this._virtualization?.getTruncationLength(null) ?? TRUNCATION_DEFAULT_LENGTH)
        : this.raw;
    }
    return this._body;
  }

  get errorMessage(): string | undefined {
    return checkLogsError(this);
  }

  get fields(): FieldDef[] {
    if (this._fields === undefined) {
      this._fields = getAllFields(this, this._getFieldLinks);
    }
    return this._fields;
  }

  get highlightedBody() {
    if (this._highlightedBody === undefined) {
      this._grammar = this._grammar ?? generateLogGrammar(this);
      const extraGrammar = generateTextMatchGrammar(this.searchWords, this._currentSearch);
      this._highlightedBody = Prism.highlight(this.body, { ...extraGrammar, ...this._grammar }, 'lokiql');
    }
    return this._highlightedBody;
  }

  get sampledMessage(): string | undefined {
    return checkLogsSampled(this);
  }

  getDisplayedFieldValue(fieldName: string): string {
    if (fieldName === LOG_LINE_BODY_FIELD_NAME) {
      return this.body;
    }
    if (this.labels[fieldName] != null) {
      return this.labels[fieldName];
    }
    const field = this.fields.find((field) => {
      return field.keys[0] === fieldName;
    });

    return field ? field.values.toString() : '';
  }

  updateCollapsedState(displayedFields: string[], container: HTMLDivElement | null) {
    const lineLength =
      displayedFields.length > 0
        ? displayedFields.map((field) => this.getDisplayedFieldValue(field)).join('').length
        : this.raw.length;
    const collapsed =
      lineLength >= (this._virtualization?.getTruncationLength(container) ?? TRUNCATION_DEFAULT_LENGTH)
        ? true
        : undefined;
    if (this.collapsed === undefined || collapsed === undefined) {
      this.collapsed = collapsed;
    }
    return this.collapsed;
  }

  setCollapsedState(collapsed: boolean) {
    if (this.collapsed !== collapsed) {
      this._body = undefined;
      this._highlightedBody = undefined;
    }
    this.collapsed = collapsed;
  }

  setCurrentSearch(search: string | undefined) {
    this._currentSearch = search;
    this._highlightedBody = undefined;
  }
}

export interface PreProcessOptions {
  escape: boolean;
  getFieldLinks?: GetFieldLinksFn;
  order: LogsSortOrder;
  timeZone: string;
  virtualization?: LogLineVirtualization;
}

export const preProcessLogs = (
  logs: LogRowModel[],
  { escape, getFieldLinks, order, timeZone, virtualization }: PreProcessOptions,
  grammar?: Grammar
): LogListModel[] => {
  const orderedLogs = sortLogRows(logs, order);
  return orderedLogs.map((log) => preProcessLog(log, { escape, getFieldLinks, grammar, timeZone, virtualization }));
};

interface PreProcessLogOptions {
  escape: boolean;
  getFieldLinks?: GetFieldLinksFn;
  grammar?: Grammar;
  timeZone: string;
  virtualization?: LogLineVirtualization;
}
const preProcessLog = (log: LogRowModel, options: PreProcessLogOptions): LogListModel => {
  return new LogListModel(log, options);
};

function logLevelToDisplayLevel(level = '') {
  switch (level) {
    case LogLevel.critical:
      return 'crit';
    case LogLevel.warning:
      return 'warn';
    case LogLevel.unknown:
      return '';
    default:
      return level;
  }
}
