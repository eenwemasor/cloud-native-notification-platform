{{/*
Common labels applied to every resource.
*/}}
{{- define "np.labels" -}}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/*
Selector labels for a given component (pass component name as $).
Usage: {{ include "np.selectorLabels" "gateway" }}
*/}}
{{- define "np.selectorLabels" -}}
app: {{ . }}
{{- end }}
