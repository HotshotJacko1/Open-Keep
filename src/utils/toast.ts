// Copyright (c) 2026. Licensed under AGPLv3.
import { toast, type ExternalToast } from "sonner";

export const showSuccess = (message: string, options?: ExternalToast) => {
  toast.success(message, options);
};

export const showError = (message: string, options?: ExternalToast) => {
  toast.error(message, options);
};

export const showLoading = (message: string) => {
  return toast.loading(message);
};

export const dismissToast = (toastId: string) => {
  toast.dismiss(toastId);
};
