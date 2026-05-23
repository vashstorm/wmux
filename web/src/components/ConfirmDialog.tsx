import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from "@mui/material";
import { useAppState } from "../state/store.js";

export function ConfirmDialog() {
	const { confirmDialog, setConfirmDialog } = useAppState();

	const dismiss = () => setConfirmDialog(null);

	return (
		<Dialog open={!!confirmDialog} onClose={dismiss} data-testid="confirm-dialog">
			{confirmDialog && (
				<>
					<DialogTitle>{confirmDialog.title}</DialogTitle>
					<DialogContent>
						<Typography>{confirmDialog.message}</Typography>
					</DialogContent>
					<DialogActions>
						<Button onClick={dismiss} data-testid="confirm-dialog-cancel">
							Cancel
						</Button>
						<Button
							onClick={() => {
								const cb = confirmDialog.onConfirm;
								setConfirmDialog(null);
								cb();
							}}
							color={confirmDialog.confirmVariant === "danger" ? "error" : "primary"}
							data-testid="confirm-dialog-confirm"
						>
							{confirmDialog.confirmText}
						</Button>
					</DialogActions>
				</>
			)}
		</Dialog>
	);
}
