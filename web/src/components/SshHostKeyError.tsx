import { useAppState } from "../state/store.js";

export function SshHostKeyError() {
	const { error } = useAppState();

	if (error?.code !== "ssh_unknown_host") {
		return null;
	}

	return (
		<div className="inline-warning-banner inline-warning-banner-error" role="alert">
			<strong>ssh_unknown_host</strong>
			<span>
				This host is not trusted yet. Use your system ssh command to connect once and add the host key to known_hosts, then retry.
			</span>
		</div>
	);
}
