package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss/credentials"
	"github.com/tigerowo/infinite-canvas/model"
)

func newOSSClient(provider model.StorageProvider) (*oss.Client, error) {
	endpoint, err := url.Parse(provider.Endpoint)
	// 内网 OSS 需要访问 VPC 地址，仅接受对应地域的官方 HTTPS Endpoint。
	if err != nil || endpoint.Scheme != "https" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" || strings.Trim(endpoint.Path, "/") != "" ||
		(endpoint.Host != "oss-"+provider.Region+".aliyuncs.com" && endpoint.Host != "oss-"+provider.Region+"-internal.aliyuncs.com") {
		return nil, errors.New("OSS Endpoint 必须是对应地域的官方 HTTPS 地址")
	}
	if !storageProviderConfigured(provider) {
		return nil, errors.New("OSS 配置不完整")
	}
	client := &http.Client{
		Timeout: 5 * time.Minute,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	cfg := oss.LoadDefaultConfig().WithRegion(provider.Region).WithEndpoint(provider.Endpoint).
		WithCredentialsProvider(credentials.NewStaticCredentialsProvider(provider.AccessKeyID, provider.SecretAccessKey)).WithHttpClient(client)
	return oss.NewClient(cfg), nil
}

func putOSSObject(provider model.StorageProvider, key, contentType string, data []byte) error {
	client, err := newOSSClient(provider)
	if err != nil {
		return err
	}
	_, err = client.PutObject(context.Background(), &oss.PutObjectRequest{
		Bucket: oss.Ptr(provider.Bucket), Key: oss.Ptr(key), ContentType: oss.Ptr(contentType), Body: bytes.NewReader(data),
	})
	return err
}

func getOSSObjectStream(provider model.StorageProvider, key, byteRange string) (storageObjectStream, error) {
	client, err := newOSSClient(provider)
	if err != nil {
		return storageObjectStream{}, err
	}
	request := &oss.GetObjectRequest{Bucket: oss.Ptr(provider.Bucket), Key: oss.Ptr(key)}
	if byteRange != "" {
		request.Range = oss.Ptr(byteRange)
	}
	result, err := client.GetObject(context.Background(), request)
	if err != nil {
		var serviceErr *oss.ServiceError
		if errors.As(err, &serviceErr) && serviceErr.StatusCode == http.StatusRequestedRangeNotSatisfiable {
			return storageObjectStream{Body: io.NopCloser(strings.NewReader("")), StatusCode: serviceErr.StatusCode, ContentRange: serviceErr.Headers.Get("Content-Range"), AcceptRanges: true}, nil
		}
		return storageObjectStream{}, err
	}
	return storageObjectStream{
		Body: result.Body, StatusCode: result.StatusCode, ContentLength: result.ContentLength,
		ContentRange: oss.ToString(result.ContentRange), AcceptRanges: true,
	}, nil
}

func deleteOSSObject(provider model.StorageProvider, key string) error {
	client, err := newOSSClient(provider)
	if err != nil {
		return err
	}
	_, err = client.DeleteObject(context.Background(), &oss.DeleteObjectRequest{Bucket: oss.Ptr(provider.Bucket), Key: oss.Ptr(key)})
	return err
}

func measureOSSProvider(provider model.StorageProvider) (int64, error) {
	client, err := newOSSClient(provider)
	if err != nil {
		return 0, err
	}
	var total int64
	request := &oss.ListObjectsV2Request{Bucket: oss.Ptr(provider.Bucket)}
	for {
		result, err := client.ListObjectsV2(context.Background(), request)
		if err != nil {
			return 0, err
		}
		for _, object := range result.Contents {
			total += object.Size
		}
		if !result.IsTruncated {
			return total, nil
		}
		request.ContinuationToken = result.NextContinuationToken
	}
}
