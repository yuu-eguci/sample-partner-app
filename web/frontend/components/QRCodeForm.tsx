/*
  NOTE: Getting started の通りにコピペしたもの。
        https://shopify.dev/apps/getting-started/build-app-example/frontend
*/
import { useState, useCallback } from "react";
import {
  Banner,
  LegacyCard,
  Form,
  FormLayout,
  TextField,
  Button,
  ChoiceList,
  Select,
  Thumbnail,
  Icon,
  LegacyStack,
  Text,
  Layout,
  EmptyState,
} from "@shopify/polaris";
import {
  ContextualSaveBar,
  ResourcePicker,
  useAppBridge,
  useNavigate,
} from "@shopify/app-bridge-react";
import { ImageIcon, AlertCircleIcon } from "@shopify/polaris-icons";
import type {
  Product,
  SelectPayload,
} from "@shopify/app-bridge/actions/ResourcePicker";

/* Import the useAuthenticatedFetch hook included in the Node app template */
import { useAuthenticatedFetch, useAppQuery } from "../hooks";

/* Import custom hooks for forms */
import {
  useForm,
  useField,
  notEmptyString,
  submitSuccess,
} from "@shopify/react-form";

import type { DiscountsResponse, QRCode as QRCodeData } from "../types";

/* 選択中の商品です。API から取得した商品と、リソースピッカーで選んだ商品とで画像の形が異なります。 */
interface SelectedProduct {
  title: string;
  handle?: string;
  images?:
    | { edges: { node: { url: string } }[] }
    | { originalSrc: string; altText?: string }[];
}

const NO_DISCOUNT_OPTION = { label: "No discount", value: "" };

/*
  The discount codes available in the store.

  This variable will only have a value after retrieving discount codes from the API.
*/
const DISCOUNT_CODES: Record<string, string> = {};

export function QRCodeForm({
  QRCode: InitialQRCode,
}: {
  QRCode?: QRCodeData;
}) {
  const [QRCode, setQRCode] = useState(InitialQRCode);
  const [showResourcePicker, setShowResourcePicker] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<
    SelectedProduct | undefined
  >(QRCode?.product);
  const navigate = useNavigate();
  const appBridge = useAppBridge();
  const fetch = useAuthenticatedFetch();
  const deletedProduct = QRCode?.product?.title === "Deleted product";

  const onSubmit = useCallback(
    async (body: {
      title: string;
      productId: string;
      variantId: string;
      handle: string;
      destination: string[];
      discountId: string;
      discountCode: string;
    }) => {
      (async () => {
        const parsedBody = { ...body, destination: body.destination[0] };
        const QRCodeId = QRCode?.id;
        /* construct the appropriate URL to send the API request to based on whether the QR code is new or being updated */
        const url = QRCodeId ? `/api/qrcodes/${QRCodeId}` : "/api/qrcodes";
        /* a condition to select the appropriate HTTP method: PATCH to update a QR code or POST to create a new QR code */
        const method = QRCodeId ? "PATCH" : "POST";
        /* use (authenticated) fetch from App Bridge to send the request to the API and, if successful, clear the form to reset the ContextualSaveBar and parse the response JSON */
        const response = await fetch(url, {
          method,
          body: JSON.stringify(parsedBody),
          headers: { "Content-Type": "application/json" },
        });
        if (response.ok) {
          makeClean();
          const QRCode: QRCodeData = await response.json();
          /* if this is a new QR code, then save the QR code and navigate to the edit page; this behavior is the standard when saving resources in the Shopify admin */
          if (!QRCodeId) {
            navigate(`/qrcodes/${QRCode.id}`);
            /* if this is a QR code update, update the QR code state in this component */
          } else {
            setQRCode(QRCode);
          }
        }
      })();
      return submitSuccess();
    },
    [QRCode, setQRCode]
  );

  /*
    Sets up the form state with the useForm hook.

    Accepts a "fields" object that sets up each individual field with a default value and validation rules.

    Returns a "fields" object that is destructured to access each of the fields individually, so they can be used in other parts of the component.

    Returns helpers to manage form state, as well as component state that is based on form state.
  */
  const {
    fields: {
      title,
      productId,
      variantId,
      handle,
      discountId,
      discountCode,
      destination,
    },
    dirty,
    reset,
    submitting,
    submit,
    makeClean,
  } = useForm({
    fields: {
      title: useField({
        value: QRCode?.title || "",
        validates: [notEmptyString("Please name your QR code")],
      }),
      productId: useField({
        value: deletedProduct ? "Deleted product" : QRCode?.product?.id || "",
        validates: [notEmptyString("Please select a product")],
      }),
      variantId: useField(QRCode?.variantId || ""),
      handle: useField(QRCode?.handle || ""),
      destination: useField(
        QRCode?.destination ? [QRCode.destination] : ["product"]
      ),
      discountId: useField(QRCode?.discountId || NO_DISCOUNT_OPTION.value),
      discountCode: useField(QRCode?.discountCode || ""),
    },
    onSubmit,
  });

  const QRCodeURL = QRCode
    ? new URL(`/qrcodes/${QRCode.id}/image`, location.toString()).toString()
    : undefined;

  /*
    This function is called with the selected product whenever the user clicks "Add" in the ResourcePicker.

    It takes the first item in the selection array and sets the selected product to an object with the properties from the "selection" argument.

    It updates the form state using the "onChange" methods attached to the form fields.

    Finally, closes the ResourcePicker.
  */
  const handleProductChange = useCallback(({ selection }: SelectPayload) => {
    /* resourceType="Product" のため、選択されるのは商品です。 */
    const product = selection[0] as Product;
    setSelectedProduct({
      title: product.title,
      images: product.images,
      handle: product.handle,
    });
    productId.onChange(product.id);
    variantId.onChange(product.variants[0]?.id ?? "");
    handle.onChange(product.handle);
    setShowResourcePicker(false);
  }, []);

  /*
    This function updates the form state whenever a user selects a new discount option.
  */
  const handleDiscountChange = useCallback((id: string) => {
    discountId.onChange(id);
    discountCode.onChange(DISCOUNT_CODES[id] || "");
  }, []);

  /*
    This function is called when a user clicks "Select product" or cancels the ProductPicker.

    It switches between a show and hide state.
  */
  const toggleResourcePicker = useCallback(
    () => setShowResourcePicker(!showResourcePicker),
    [showResourcePicker]
  );

  const [isDeleting, setIsDeleting] = useState(false);
  const deleteQRCode = useCallback(async () => {
    if (!QRCode) return;
    reset();
    /* The isDeleting state disables the download button and the delete QR code button to show the merchant that an action is in progress */
    setIsDeleting(true);
    const response = await fetch(`/api/qrcodes/${QRCode.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });

    if (response.ok) {
      navigate(`/`);
    }
  }, [QRCode]);

  /*
    This function runs when a user clicks the "Go to destination" button.

    It uses data from the App Bridge context as well as form state to construct destination URLs using the URL helpers you created.
  */
  const goToDestination = useCallback(() => {
    if (!selectedProduct) return;
    const data = {
      host: appBridge.hostOrigin,
      productHandle: handle.value || selectedProduct.handle || "",
      discountCode: discountCode.value || undefined,
      variantId: variantId.value,
    };

    const targetURL =
      deletedProduct || destination.value[0] === "product"
        ? productViewURL(data)
        : productCheckoutURL(data);

    window.open(targetURL, "_blank", "noreferrer,noopener");
  }, [QRCode, selectedProduct, destination, discountCode, handle, variantId]);

  const {
    data: discounts,
    isLoading: isLoadingDiscounts,
    isError: discountsError,
    /* useAppQuery makes a query to `/api/discounts`, which the backend authenticates before fetching the data from the Shopify GraphQL Admin API */
  } = useAppQuery<DiscountsResponse>({ url: "/api/discounts" });

  /*
    This array is used in a select field in the form to manage discount options
  */
  const discountOptions = discounts
    ? [
        NO_DISCOUNT_OPTION,
        ...discounts.codeDiscountNodes.edges.map(
          ({ node: { id, codeDiscount } }) => {
            DISCOUNT_CODES[id] = codeDiscount.codes.edges[0].node.code;

            return {
              label: codeDiscount.codes.edges[0].node.code,
              value: id,
            };
          }
        ),
      ]
    : [];

  /*
    These variables are used to display product images, and will be populated when image URLs can be retrieved from the Admin.
  */
  const images = selectedProduct?.images;
  const imageSrc = Array.isArray(images)
    ? images[0]?.originalSrc
    : images?.edges?.[0]?.node?.url;
  const altText =
    (Array.isArray(images) ? images[0]?.altText : undefined) ||
    selectedProduct?.title;

  /* The form layout, created using Polaris and App Bridge components. */
  return (
    <LegacyStack vertical>
      {deletedProduct && (
        <Banner
          title="The product for this QR code no longer exists."
          tone="critical"
        >
          <p>
            Scans will be directed to a 404 page, or you can choose another
            product for this QR code.
          </p>
        </Banner>
      )}
      <Layout>
        <Layout.Section>
          <Form onSubmit={submit}>
            <ContextualSaveBar
              saveAction={{
                label: "Save",
                onAction: submit,
                loading: submitting,
                disabled: submitting,
              }}
              discardAction={{
                label: "Discard",
                onAction: reset,
                loading: submitting,
                disabled: submitting,
              }}
              visible={dirty}
              fullWidth
            />
            <FormLayout>
              <LegacyCard sectioned title="Title">
                <TextField
                  {...title}
                  autoComplete="off"
                  label="Title"
                  labelHidden
                  helpText="Only store staff can see this title"
                />
              </LegacyCard>

              <LegacyCard
                title="Product"
                actions={[
                  {
                    content: productId.value
                      ? "Change product"
                      : "Select product",
                    onAction: toggleResourcePicker,
                  },
                ]}
              >
                <LegacyCard.Section>
                  {showResourcePicker && (
                    <ResourcePicker
                      resourceType="Product"
                      showVariants={false}
                      selectMultiple={false}
                      onCancel={toggleResourcePicker}
                      onSelection={handleProductChange}
                      open
                    />
                  )}
                  {productId.value ? (
                    <LegacyStack alignment="center">
                      {imageSrc ? (
                        <Thumbnail
                          source={imageSrc}
                          alt={altText ?? ""}
                        />
                      ) : (
                        <Thumbnail source={ImageIcon} alt="" size="small" />
                      )}
                      <Text as="span" fontWeight="bold">
                        {selectedProduct?.title}
                      </Text>
                    </LegacyStack>
                  ) : (
                    <LegacyStack vertical spacing="extraTight">
                      <Button onClick={toggleResourcePicker}>
                        Select product
                      </Button>
                      {productId.error && (
                        <LegacyStack spacing="tight">
                          <Icon source={AlertCircleIcon} tone="critical" />
                          <Text as="span" tone="critical">
                            {productId.error}
                          </Text>
                        </LegacyStack>
                      )}
                    </LegacyStack>
                  )}
                </LegacyCard.Section>
                <LegacyCard.Section title="Scan Destination">
                  <ChoiceList
                    title="Scan destination"
                    titleHidden
                    choices={[
                      { label: "Link to product page", value: "product" },
                      {
                        label: "Link to checkout page with product in the cart",
                        value: "checkout",
                      },
                    ]}
                    selected={destination.value}
                    onChange={destination.onChange}
                  />
                </LegacyCard.Section>
              </LegacyCard>
              <LegacyCard
                sectioned
                title="Discount"
                actions={[
                  {
                    content: "Create discount",
                    onAction: () =>
                      navigate(
                        {
                          name: "Discount",
                          resource: {
                            create: true,
                          },
                        },
                        { target: "new" }
                      ),
                  },
                ]}
              >
                <Select
                  label="discount code"
                  options={discountOptions}
                  onChange={handleDiscountChange}
                  value={discountId.value}
                  disabled={isLoadingDiscounts || discountsError}
                  labelHidden
                />
              </LegacyCard>
            </FormLayout>
          </Form>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <LegacyCard sectioned title="QR code">
            {QRCodeURL ? (
              <EmptyState imageContained={true} image={QRCodeURL} />
            ) : (
              <EmptyState image="">
                <p>Your QR code will appear here after you save.</p>
              </EmptyState>
            )}
            <LegacyStack vertical>
              <Button
                fullWidth
                variant="primary"
                download
                url={QRCodeURL}
                disabled={!QRCode || isDeleting}
              >
                Download
              </Button>
              <Button
                fullWidth
                onClick={goToDestination}
                disabled={!selectedProduct}
              >
                Go to destination
              </Button>
            </LegacyStack>
          </LegacyCard>
        </Layout.Section>
        <Layout.Section>
          {QRCode?.id && (
            <Button
              tone="critical"
              onClick={deleteQRCode}
              loading={isDeleting}
            >
              Delete QR code
            </Button>
          )}
        </Layout.Section>
      </Layout>
    </LegacyStack>
  );
}

/* Builds a URL to the selected product */
function productViewURL({
  host,
  productHandle,
  discountCode,
}: {
  host: string;
  productHandle: string;
  discountCode?: string;
}): string {
  const url = new URL(host);
  const productPath = `/products/${productHandle}`;

  /*
    If a discount is selected, then build a URL to the selected discount that redirects to the selected product: /discount/{code}?redirect=/products/{product}
  */
  if (discountCode) {
    url.pathname = `/discount/${discountCode}`;
    url.searchParams.append("redirect", productPath);
  } else {
    url.pathname = productPath;
  }

  return url.toString();
}

/* Builds a URL to a checkout that contains the selected product */
function productCheckoutURL({
  host,
  variantId,
  quantity = 1,
  discountCode,
}: {
  host: string;
  variantId: string;
  quantity?: number;
  discountCode?: string;
}): string {
  const url = new URL(host);
  const id = variantId.replace(
    /gid:\/\/shopify\/ProductVariant\/([0-9]+)/,
    "$1"
  );

  url.pathname = `/cart/${id}:${quantity}`;

  /* Builds a URL to a checkout that contains the selected product with a discount code applied */
  if (discountCode) {
    url.searchParams.append("discount", discountCode);
  }

  return url.toString();
}
