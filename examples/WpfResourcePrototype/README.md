# WPF resource mapping prototype for FigVam Design Tokens

This example is a concrete mapping prototype for the `figvam.portable-ui/4` effective resource contract. It is not a general WPF/Avalonia/Uno exporter.

- `Color` maps to WPF `Color` and `SolidColorBrush`; theme-specific brushes can be exchanged through merged `ResourceDictionary` entries referenced as `DynamicResource`.
- `Dimension` maps to pixel-valued `Double` for `FontSize`, `Thickness` values and dimensions. The caller must map each FigVam semantic category to an appropriate WPF property; units are not assumed interchangeable.
- `FontFamily` maps to WPF `FontFamily`; `FontWeight` to WPF `FontWeight`.
- `TextStyle` maps to a `TextBlock` `Style`, `BorderStyle` to a `Border` `Style`. `BasedOnStyleId` maps to WPF `BasedOn` only for the same target control type.
- `Light`/`Dark`: separate resources for each theme and switch merged dictionaries explicitly. The prototype shows one theme.
- `lineHeight` in FigVam is a multiplier of `fontSize`. WPF `TextBlock.LineHeight` is an absolute value; without a verified conversion and layout test this property is **not exported**. It must produce an explicit unsupported-conversion diagnostic if requested by an adapter.
- `letterSpacing`: WPF `TextBlock` does not expose the same general character-spacing property as CSS. Do not silently discard nonzero values: adapters must diagnose unsupported conversion.
- Individual node and ScreenVariant overrides remain higher priority than inherited style values in the FigVam neutral contract.

The source of truth for effective values is `DocumentResourceExporter`, which calls the existing server token and style resolvers. The example intentionally leaves runtime resource swapping and control-specific semantics to a future platform adapter.
