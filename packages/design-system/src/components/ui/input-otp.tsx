'use client';

import { OTPInput, OTPInputContext, REGEXP_ONLY_DIGITS } from 'input-otp';
import * as React from 'react';
import { cn } from '../../lib/utils';

function InputOTP({ className, containerClassName, ...props }: React.ComponentProps<typeof OTPInput> & { containerClassName?: string }) {
  return (
    <OTPInput
      className={cn('disabled:cursor-not-allowed', className)}
      containerClassName={cn('flex items-center gap-2 has-disabled:opacity-50', containerClassName)}
      data-slot="input-otp"
      pasteTransformer={(value) => value.replace(/\D/g, '')}
      pattern={REGEXP_ONLY_DIGITS}
      {...props}
    />
  );
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-2', className)} data-slot="input-otp-group" {...props} />;
}

function InputOTPSlot({ index, className, ...props }: React.ComponentProps<'div'> & { index: number }) {
  const context = React.useContext(OTPInputContext);
  const slot = context?.slots[index];

  return (
    <div
      className={cn(
        'relative flex size-11 items-center justify-center rounded-md border border-input bg-transparent font-mono font-medium text-base text-foreground shadow-xs outline-none transition-all data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:ring-3 data-[active=true]:ring-ring/50 dark:bg-input/30',
        className,
      )}
      data-active={slot?.isActive}
      data-slot="input-otp-slot"
      {...props}
    >
      {slot?.char}
      {slot?.hasFakeCaret ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-pulse bg-foreground" />
        </div>
      ) : null}
    </div>
  );
}

export { InputOTP, InputOTPGroup, InputOTPSlot };
