import React, {
    useEffect,
    useState,
    FunctionComponent,
    useMemo,
    useRef,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { unescape } from "html-escaper";
import Loader from "./../loader";

import type {
    H5PEditorStatus,
    H5PEditorContent,
    EditorSettings,
} from "@tinhr/h5p-react";

const prepareMarkupForPassing = (markup: string) => {
    return unescape(markup);
};

const getLabel = (id: string, lang: string, isNew: boolean) => {
    const labels: Record<string, Record<string, string>> = {
        en: {
            "loading": "Loading",
            "submit data": isNew ? "Create H5P" : "Update H5P"
        },
        km: {
            "loading": "កំពុងផ្ទុក",
            "submit data": isNew ? "បង្កើត H5P" : "ធ្វើបច្ចុប្បន្នភាព H5P"
        },
        jp: {
            "loading": "読み込み中",
            "submit data": isNew ? "H5Pを作成する" : "H5Pを更新する"
        },
        vi: {
            "loading": "Đang Tải",
            "submit data": isNew ? "Tạo H5P" : "Cập nhật H5P"
        }
    };

    const langId = lang as keyof typeof labels;

    if (labels[langId] && labels[langId][id]) {
        return labels[langId][id];
    }
    return id;
};

export const Editor: FunctionComponent<{
    id?: number | string;
    state: EditorSettings;
    allowSameOrigin?: boolean;
    onSubmit?: (data: H5PEditorContent, id?: string | number) => void;
    onError?: (error: unknown) => void;
    loading?: boolean;
    lang?: string;
    iframeId?: string;
    isNew?: boolean; // Add isNew prop
}> = ({
          id,
          onSubmit,
          state,
          allowSameOrigin = false,
          onError,
          loading = false,
          lang = "vi",
          iframeId = "h5p-editor",
          isNew = true, // Default to true for new content
      }) => {
    const [height, setHeight] = useState<number>(100);
    const iFrameRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!(event.origin === window.location.origin) && !allowSameOrigin) {
                return;
            }
            if (event.data.iFrameHeight) {
                setHeight(event.data.iFrameHeight);
            }
            if (event.data.h5pEditorStatus) {
                const status: H5PEditorStatus = event.data;
                if (status.h5pEditorStatus === "success") {
                    onSubmit &&
                    onSubmit(
                        {
                            ...status.data,
                            nonce: state.nonce,
                        },
                        id
                    );
                }

                status.h5pEditorStatus === "error" && onError && onError(status.error);
            }
        };

        window && window.addEventListener("message", onMessage);
        return () => {
            window && window.removeEventListener("message", onMessage);
        };
    }, [iFrameRef, state, onSubmit, id]);

    const src = useMemo(() => {
        const settings = state;
        if (!settings) return "";

        const content = state.contents
            ? state?.contents[Object.keys(state.contents)[0]]
            : null;
        const params = content ? content.jsonContent : "";

        try {
            params && JSON.parse(params);
        } catch (er: any) {
            onError && onError(er && er.toString());
            return null;
        }

        const library = content ? content.library : "";

        const scriptInline = `
      (function ($) {
          const postMessage = (data) => parent.postMessage(data, "${
            window.location.origin
        }");
          const resizeObserver = new ResizeObserver((entries) =>
              postMessage({ iFrameHeight: entries[0].contentRect.height })
          );
          const params = ${"`"}${params}${"`"}.split("\\n").join('');
          let token = "${state.token}";
          
          const onMessage = (e) => {
            if(e.data?.type === "TOKEN_CHANGED") {
              token = e.data?.token ?? null;
            }
          };
          
          window.addEventListener("message", onMessage);
              
          ns.init = function () {
              ns.$ = H5P.jQuery;
              ns.basePath = H5PIntegration.editor.libraryUrl;
              ns.fileIcon = H5PIntegration.editor.fileIcon;
              ns.ajaxPath = H5PIntegration.editor.ajaxPath;
              ns.filesPath = H5PIntegration.editor.filesPath;
              ns.apiVersion = H5PIntegration.editor.apiVersion;
              ns.copyrightSemantics = H5PIntegration.editor.copyrightSemantics;
              ns.assets = H5PIntegration.editor.assets;
              ns.baseUrl = H5PIntegration.baseUrl;
              ns.metadataSemantics = H5PIntegration.editor.metadataSemantics;
              if (H5PIntegration.editor.nodeVersionId !== undefined) {
                  ns.contentId = H5PIntegration.editor.nodeVersionId;
              }
              const h5peditor = new ns.Editor('${library}', params, document.getElementById("h5p-editor"));
              H5P.externalDispatcher.on("xAPI", (event) => postMessage(event));
              H5P.externalDispatcher.on("resize", (event) => postMessage(event));
              resizeObserver.observe(document.querySelector(".h5p-editor-wrapper"));
              $("#h5p-editor-submit").click(() => {
                  h5peditor.getContent(data => postMessage({h5pEditorStatus:"success", data}), error =>  postMessage({h5pEditorStatus:"error", error}))
              } );
          };
          ns.getAjaxUrl = function (action, parameters) {
              var url = H5PIntegration.editor.ajaxPath + action;
              url += action === "files" ? "/${settings.nonce}" : "";
              url += token ? "?_token=" + token : "";
              url += "${lang ? "&lang=" + lang : ""}";
              if (parameters !== undefined) {
                  var separator = url.indexOf("?") === -1 ? "?" : "&";
                  for (var property in parameters) {
                      if (parameters.hasOwnProperty(property)) {
                          url += separator + property + "=" + parameters[property];
                          separator = "&";
                      }
                  }
              }
              return url;
          };
          $(document).ready(ns.init);
      })(H5P.jQuery);
      `;

        const markup = renderToStaticMarkup(
            <html>
            <head>
                <style>{` body, html {margin:0; padding:0;}`}</style>
                <script>
                    {`const H5PIntegration = window.H5PIntegration = ${JSON.stringify(
                        settings
                    )}; `}
                </script>
                {settings.core.scripts.map((script) => (
                    <script key={script} src={script}></script>
                ))}
                {settings.core.styles.map((style) => (
                    <link
                        type="text/css"
                        rel="stylesheet"
                        key={style}
                        href={style}
                    ></link>
                ))}
            </head>
            <body>
            <div className="h5p-editor-wrapper">
                <div id="h5p-editor" className="height-observer">
                    {getLabel("loading", lang, isNew)}
                </div>
                <p></p>
                <button className="h5p-core-button" id="h5p-editor-submit">
                    {getLabel("submit data", lang, isNew)}
                </button>
                <script dangerouslySetInnerHTML={{ __html: scriptInline }} />
            </div>
            </body>
            </html>
        );

        const pMarkup = prepareMarkupForPassing(markup);

        return window.URL.createObjectURL(
            new Blob([pMarkup], {
                type: "text/html",
            })
        );
    }, [state, isNew]);

    return (
        <div
            className="h5p-editor"
            style={{ height: height, position: "relative" }}
        >
            {loading && <Loader />}

            {src && (
                <iframe
                    ref={iFrameRef}
                    title="editor"
                    src={src}
                    id={iframeId}
                    style={{
                        width: "100%",
                        height: "100%",
                        margin: 0,
                        padding: 0,
                        border: "none",
                    }}
                ></iframe>
            )}
        </div>
    );
};

export default Editor;