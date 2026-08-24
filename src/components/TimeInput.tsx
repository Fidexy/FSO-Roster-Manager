// 24-hour time text input. Accepts "HH:MM" (00:00–23:59).
// Auto-inserts the colon after two digits and rejects non-numeric characters.

import React from 'react';

interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}

const TimeInput = React.forwardRef<HTMLInputElement, TimeInputProps>(
  ({ value, onChange, required, disabled }, ref) => {

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let raw = e.target.value.replace(/[^0-9:]/g, '');

      // Auto-insert colon when user types the second digit of the hour
      if (/^\d{2}$/.test(raw) && !value.includes(':')) {
        raw = raw + ':';
      }

      // Clamp hours (00-23) and minutes (00-59) on complete input
      if (/^\d{2}:\d{2}$/.test(raw)) {
        const [hh, mm] = raw.split(':');
        const h = Math.min(23, parseInt(hh, 10));
        const m = Math.min(59, parseInt(mm, 10));
        raw = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }

      if (raw.length <= 5) onChange(raw);
    };

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={handleChange}
        placeholder="HH:MM"
        maxLength={5}
        required={required}
        disabled={disabled}
        pattern="\d{2}:\d{2}"
        className="w-full h-8 rounded border border-border bg-white px-2.5 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors disabled:opacity-50 tabular-nums"
      />
    );
  }
);
TimeInput.displayName = 'TimeInput';

export default TimeInput;
