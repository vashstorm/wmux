import { useState, useEffect, useCallback } from "react";
import { Box, Typography, IconButton, TextField, Button, List, ListItem, ListItemText, Stack, Collapse } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import { useAppState } from "../../state/store.js";
import { listProjects, createProject, updateProject, deleteProject, getProject } from "../../api/client.js";
import type { Project, NewProject } from "../../api/client.js";
import { ApiError } from "../../api/errors.js";

export function ProjectsView() {
	const { selectedProject, setSelectedProject } = useAppState();
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showForm, setShowForm] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [formName, setFormName] = useState("");
	const [formPath, setFormPath] = useState("");
	const [formDescription, setFormDescription] = useState("");

	const loadProjects = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await listProjects();
			setProjects(data);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to load projects");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { loadProjects(); }, [loadProjects]);

	const resetForm = () => {
		setFormName("");
		setFormPath("");
		setFormDescription("");
		setShowForm(false);
		setEditingId(null);
	};

	const handleSelect = (project: Project) => {
		if (selectedProject?.id === project.id) {
			setSelectedProject(null);
			return;
		}
		setSelectedProject(project);
	};

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!formName.trim()) return;
		setError(null);
		try {
			const created = await createProject({ name: formName.trim(), path: formPath.trim(), description: formDescription.trim() });
			resetForm();
			await loadProjects();
			setSelectedProject(created);
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to create project");
		}
	};

	const handleUpdate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!editingId) return;
		setError(null);
		try {
			await updateProject(editingId, { name: formName.trim() || undefined, path: formPath.trim(), description: formDescription.trim() });
			await refreshSelectedProject(editingId);
			resetForm();
			await loadProjects();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to update project");
		}
	};

	const handleDelete = async (id: string) => {
		if (!window.confirm("Delete this project?")) return;
		setError(null);
		try {
			await deleteProject(id);
			if (selectedProject?.id === id) {
				setSelectedProject(null);
			}
			await loadProjects();
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Failed to delete project");
		}
	};

	const refreshSelectedProject = useCallback(async (id: string) => {
		if (!selectedProject || selectedProject.id !== id) return;
		try {
			const updated = await getProject(id);
			setSelectedProject(updated);
		} catch {
			// stale reads are acceptable
		}
	}, [selectedProject, setSelectedProject]);

	const startEdit = (project: Project) => {
		setEditingId(project.id);
		setFormName(project.name);
		setFormPath(project.path);
		setFormDescription(project.description);
		setShowForm(true);
	};

	return (
		<Box data-testid="projects-view" sx={{ minHeight: 1 }}>
			<Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}>
				<Typography variant="subtitle2" sx={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)" }}>
					Projects
				</Typography>
				<IconButton size="small" onClick={() => { resetForm(); setShowForm(!showForm); }} data-testid="projects-add-button" aria-label="Add project">
					{showForm ? <CloseIcon fontSize="small" /> : <AddIcon fontSize="small" />}
				</IconButton>
			</Stack>

			<Collapse in={showForm} timeout={200} unmountOnExit>
				<Box component="form" onSubmit={editingId ? handleUpdate : handleCreate} data-testid="project-form" sx={{ mb: 1, p: 1, bgcolor: "background.default", borderRadius: "var(--radius-sm)", border: "1px solid", borderColor: "divider" }}>
					<TextField size="small" fullWidth placeholder="Project name" value={formName} onChange={(e) => setFormName(e.target.value)} data-testid="project-name-input" sx={{ mb: 0.5 }} />
					<TextField size="small" fullWidth placeholder="Path (optional)" value={formPath} onChange={(e) => setFormPath(e.target.value)} data-testid="project-path-input" sx={{ mb: 0.5 }} />
					<TextField size="small" fullWidth placeholder="Description (optional)" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} data-testid="project-description-input" sx={{ mb: 0.5 }} />
					<Stack direction="row" spacing={0.5}>
						<Button type="submit" size="small" variant="contained" data-testid="project-submit-button">{editingId ? "Update" : "Create"}</Button>
						<Button size="small" onClick={resetForm}>Cancel</Button>
					</Stack>
				</Box>
			</Collapse>

			{error && (
				<Typography color="error" variant="caption" data-testid="projects-error" sx={{ display: "block", mb: 1 }}>
					{error}
				</Typography>
			)}

			{loading && projects.length === 0 ? (
				<Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 2 }}>Loading...</Typography>
			) : projects.length === 0 ? (
				<Typography variant="body2" color="text.secondary" data-testid="projects-empty" sx={{ textAlign: "center", py: 2 }}>No projects yet</Typography>
			) : (
				<List disablePadding dense>
					{projects.map((project) => (
						<ListItem
							key={project.id}
							data-testid={`project-item-${project.id}`}
							onClick={() => handleSelect(project)}
							sx={{
								px: 1,
								py: 0.5,
								borderRadius: "var(--radius-sm)",
								cursor: "pointer",
								bgcolor: selectedProject?.id === project.id ? "primary.main" : "transparent",
								color: selectedProject?.id === project.id ? "primary.contrastText" : "inherit",
								"&:hover": { bgcolor: selectedProject?.id === project.id ? "primary.dark" : "action.hover" },
								borderLeft: selectedProject?.id === project.id ? "3px solid" : "3px solid transparent",
								borderColor: selectedProject?.id === project.id ? "primary.light" : "transparent",
							}}
							secondaryAction={
								<Stack direction="row" spacing={0.25}>
									<IconButton size="small" onClick={(e) => { e.stopPropagation(); startEdit(project); }} data-testid={`project-edit-${project.id}`} aria-label="Edit"><EditIcon fontSize="small" /></IconButton>
									<IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDelete(project.id); }} data-testid={`project-delete-${project.id}`} aria-label="Delete"><DeleteIcon fontSize="small" /></IconButton>
								</Stack>
							}
						>
							<ListItemText
							primary={project.name}
							secondary={project.path || project.description || undefined}
						/>
						</ListItem>
					))}
				</List>
			)}
		</Box>
	);
}
