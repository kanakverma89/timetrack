import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { entry, populatedWeek, week } from '../../test/fixtures';
import { DailyHoursCard } from './DailyHoursCard';
import { TimeEntryList, groupByDate } from './TimeEntryList';
import { TimesheetStatusBadge } from './TimesheetStatusBadge';
import { WeekNavigator } from './WeekNavigator';
import { WeeklySummary } from './WeeklySummary';

describe('WeekNavigator', () => {
  const noop = () => undefined;

  it('shows the formatted range and fires navigation callbacks', async () => {
    const user = userEvent.setup();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onCurrent = vi.fn();
    render(
      <WeekNavigator
        start="2026-10-19"
        end="2026-10-25"
        isCurrentWeek={false}
        onPrevious={onPrevious}
        onNext={onNext}
        onCurrent={onCurrent}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Oct 19 – Oct 25, 2026' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /previous week/i }));
    await user.click(screen.getByRole('button', { name: /next week/i }));
    await user.click(screen.getByRole('button', { name: /current week/i }));
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    expect(onCurrent).toHaveBeenCalledOnce();
  });

  it('disables the current-week shortcut when already on the current week', () => {
    render(
      <WeekNavigator
        start="2026-10-19"
        end="2026-10-25"
        isCurrentWeek
        onPrevious={noop}
        onNext={noop}
        onCurrent={noop}
      />,
    );
    expect(screen.getByRole('button', { name: /current week/i })).toBeDisabled();
  });

  it('shows a placeholder label while the range is unknown', () => {
    render(
      <WeekNavigator
        start={null}
        end={null}
        isCurrentWeek={false}
        onPrevious={noop}
        onNext={noop}
        onCurrent={noop}
      />,
    );
    expect(screen.getByRole('heading', { name: /loading week/i })).toBeInTheDocument();
  });
});

describe('DailyHoursCard', () => {
  it('shows day, date and hours, and marks today with text', () => {
    render(
      <ul>
        <DailyHoursCard date="2026-10-21" hours="7.50" isToday />
      </ul>,
    );
    const card = screen.getByTestId('day-card');
    expect(within(card).getByText('Wed')).toBeInTheDocument();
    expect(within(card).getByText('Oct 21')).toBeInTheDocument();
    expect(card).toHaveTextContent('7.50');
    expect(within(card).getByText('Today')).toBeInTheDocument();
    expect(card).toHaveClass('has-hours');
  });

  it('renders an empty day without the highlight', () => {
    render(
      <ul>
        <DailyHoursCard date="2026-10-24" hours="0.00" isToday={false} />
      </ul>,
    );
    const card = screen.getByTestId('day-card');
    expect(card).not.toHaveClass('has-hours');
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
  });
});

describe('WeeklySummary', () => {
  it('renders every figure from the API response without recomputing', () => {
    render(<WeeklySummary week={populatedWeek()} />);
    expect(screen.getByTestId('total-hours')).toHaveTextContent('10.50');
    expect(screen.getByTestId('capped-hours')).toHaveTextContent('8.00');
    expect(screen.getByTestId('non-capped-hours')).toHaveTextContent('2.50');
    expect(screen.getByTestId('entry-count')).toHaveTextContent('2');
    expect(screen.getByTestId('draft-count')).toHaveTextContent('2');
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });
});

describe('TimesheetStatusBadge', () => {
  it.each([
    ['DRAFT', 'Draft'],
    ['SUBMITTED', 'Submitted'],
    ['APPROVED', 'Approved'],
    ['REJECTED', 'Rejected'],
  ] as const)('labels %s with text', (status, label) => {
    render(<TimesheetStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('TimeEntryList', () => {
  it('shows an empty state when there are no entries', () => {
    const w = week();
    render(<TimeEntryList entries={[]} dailyTotals={w.daily_totals} status="DRAFT" />);
    expect(screen.getByText('No time entries this week')).toBeInTheDocument();
  });

  it('groups entries by date, in date order, with the daily total', () => {
    const w = populatedWeek();
    render(
      <TimeEntryList
        entries={[...w.entries].reverse()}
        dailyTotals={w.daily_totals}
        status="DRAFT"
      />,
    );
    const groups = screen.getAllByTestId('entry-group');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveTextContent('Monday, October 19');
    expect(groups[0]).toHaveTextContent('8.00 h');
    expect(groups[1]).toHaveTextContent('Tuesday, October 20');
    expect(groups[1]).toHaveTextContent('2.50 h');
  });

  it('shows project, task, earning code, classification and hours on each entry', () => {
    const w = populatedWeek();
    render(<TimeEntryList entries={w.entries} dailyTotals={w.daily_totals} status="DRAFT" />);
    const [first, second] = screen.getAllByTestId('entry-card');
    expect(first).toHaveTextContent('PRJ-001');
    expect(first).toHaveTextContent('Development');
    expect(first).toHaveTextContent('Regular Work (REG) · Capped');
    expect(second).toHaveTextContent('Overtime (OVT) · Non-capped');
    expect(second).not.toHaveTextContent('›');
  });

  it('renders descriptions as plain text, never as HTML', () => {
    const malicious = entry({ description: '<img src=x onerror=alert(1)> <b>bold</b>' });
    const w = week();
    const { container } = render(
      <TimeEntryList entries={[malicious]} dailyTotals={w.daily_totals} status="DRAFT" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });

  it('truncates long descriptions and lets the user expand them', async () => {
    const user = userEvent.setup();
    const long = 'word '.repeat(60).trim();
    const w = week();
    render(
      <TimeEntryList
        entries={[entry({ description: long })]}
        dailyTotals={w.daily_totals}
        status="DRAFT"
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Show more' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(long)).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText(long)).toBeInTheDocument();
  });
});

describe('groupByDate', () => {
  it('sorts groups chronologically', () => {
    const grouped = groupByDate([
      entry({ id: 'a', work_date: '2026-10-21' }),
      entry({ id: 'b', work_date: '2026-10-19' }),
      entry({ id: 'c', work_date: '2026-10-21' }),
    ]);
    expect(grouped.map(([date, items]) => [date, items.length])).toEqual([
      ['2026-10-19', 1],
      ['2026-10-21', 2],
    ]);
  });
});
