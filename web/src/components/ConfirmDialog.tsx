import { useAppState } from "../state/store.js";

export function ConfirmDialog() {
	const { confirmDialog, setConfirmDialog } = useAppState();

	if (!confirmDialog) return null;

	return (
		<div className="confirm-dialog-overlay" data-testid="confirm-dialog">
			<div className="confirm-dialog">
				<h3 className="confirm-dialog-title">{confirmDialog.title}</h3>
				<p className="confirm-dialog-message">{confirmDialog.message}</p>
				<div className="confirm-dialog-actions">
					<button
						type="button"
						className="confirm-dialog-cancel"
						onClick={() => setConfirmDialog(null)}
						data-testid="confirm-dialog-cancel"
					>
						Cancel
					</button>
					<button
						type="button"
						className={`confirm-dialog-confirm ${confirmDialog.confirmVariant === "danger" ? "is-danger" : ""}`}
						onClick={() => {
							confirmDialog.onConfirm();
							setConfirmDialog(null);
						}}
						data-testid="confirm-dialog-confirm"
					>
						{confirmDialog.confirmText}
					</button>
				</div>
			</div>
		</div>
	);
}
