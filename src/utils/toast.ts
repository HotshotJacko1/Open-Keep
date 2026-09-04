// Copyright (c) 2026. Licensed under AGPLv3.
import { toast } from "sonner";

export const showSuccess = (message: string, options?: any) => {
  toast.success(message, options);
};

export const showError = (message: string, options?: any) => {
  toast.error(message, options);
};

export const showLoading = (message: string) => {
  return toast.loading(message);
};

export const dismissToast = (toastId: string) => {
  toast.dismiss(toastId);
};
