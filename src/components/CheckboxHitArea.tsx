// Copyright (c) 2026. Licensed under AGPLv3.
import React from "react";
import { cn } from "@/lib/utils";

interface CheckboxHitAreaProps {
  children: React.ReactNode;
  disabled?: boolean;
  /** Pass a non-interactive placeholder (e.g. a greyed read-only row) so it keeps the same geometry. */
  inert?: boolean;
  className?: string;
}

/**
 * Widens a checklist row's small checkbox into a 48px column that spans the
 * full row height (padding included) -- M3's 48x48 touch target -- without
 * changing how the checkbox looks. The negative margins eat the row's `gap-2`
 * on both sides and its `py-2`, so neighbouring rows' tap areas meet exactly
 * and never overlap. Rows with different padding override `-my-2`.
 *
 * It is a <label>: a tap anywhere inside it is forwarded to the checkbox
 * button, which is the label's first labelable descendant.
 */
const CheckboxHitArea: React.FC<CheckboxHitAreaProps> = ({ children, disabled, inert, className }) => {
  const classes = cn(
    "-mx-2 -my-2 w-12 shrink-0 self-stretch flex justify-center",
    inert || disabled ? "cursor-default" : "cursor-pointer",
    className
  );
  return inert
    ? <div className={classes}>{children}</div>
    : <label className={classes}>{children}</label>;
};

export default CheckboxHitArea;
